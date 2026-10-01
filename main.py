"""
Telecom Customer Churn API (FastAPI)

Serves the final Logistic Regression pipeline from the notebook
(churn_lr_pipeline.joblib) and the website in ./static.

Run:
    uvicorn main:app --reload
Then open:
    http://127.0.0.1:8000        -> website
    http://127.0.0.1:8000/docs   -> interactive API docs
"""

import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal, Union

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, model_validator

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
MODEL_PATH = Path(os.getenv("MODEL_PATH", BASE_DIR / "churn_lr_pipeline.joblib"))

# Evaluation numbers copied from the notebook (test set, Logistic Regression).
# They are only displayed on the website. Update them if you retrain the model.
MODEL_METRICS = {
    "cv_roc_auc": 0.8447,
    "test_roc_auc": 0.8387,
    "test_pr_auc": 0.6285,
    "recall_at_threshold": 0.933,
    "precision_at_threshold": 0.425,
    "recall_default_threshold": 0.773,
    "precision_default_threshold": 0.506,
}

INTERNET_ADDONS = [
    "OnlineSecurity",
    "OnlineBackup",
    "DeviceProtection",
    "TechSupport",
    "StreamingTV",
    "StreamingMovies",
]

YesNo = Literal["Yes", "No"]
YesNoNoInternet = Literal["Yes", "No", "No internet service"]


# ----------------------------------------------------------------------------
# Request / response schemas (field names match the training columns exactly)
# ----------------------------------------------------------------------------
class CustomerFeatures(BaseModel):
    gender: Literal["Female", "Male"]
    SeniorCitizen: Literal[0, 1]
    Partner: YesNo
    Dependents: YesNo
    tenure: int = Field(ge=0, le=100, description="Months with the company")
    PhoneService: YesNo
    MultipleLines: Literal["Yes", "No", "No phone service"]
    InternetService: Literal["DSL", "Fiber optic", "No"]
    OnlineSecurity: YesNoNoInternet
    OnlineBackup: YesNoNoInternet
    DeviceProtection: YesNoNoInternet
    TechSupport: YesNoNoInternet
    StreamingTV: YesNoNoInternet
    StreamingMovies: YesNoNoInternet
    Contract: Literal["Month-to-month", "One year", "Two year"]
    PaperlessBilling: YesNo
    PaymentMethod: Literal[
        "Electronic check",
        "Mailed check",
        "Bank transfer (automatic)",
        "Credit card (automatic)",
    ]
    MonthlyCharges: float = Field(ge=0, le=500, description="Monthly bill amount")

    @model_validator(mode="after")
    def check_service_consistency(self):
        """The training data never contains contradictory service combinations."""
        if self.PhoneService == "No" and self.MultipleLines != "No phone service":
            raise ValueError(
                "MultipleLines must be 'No phone service' when PhoneService is 'No'"
            )
        if self.PhoneService == "Yes" and self.MultipleLines == "No phone service":
            raise ValueError(
                "MultipleLines cannot be 'No phone service' when PhoneService is 'Yes'"
            )

        addon_values = [getattr(self, name) for name in INTERNET_ADDONS]
        if self.InternetService == "No" and any(
            v != "No internet service" for v in addon_values
        ):
            raise ValueError(
                "Internet add-ons must be 'No internet service' when InternetService is 'No'"
            )
        if self.InternetService != "No" and any(
            v == "No internet service" for v in addon_values
        ):
            raise ValueError(
                "Internet add-ons cannot be 'No internet service' when the customer has internet"
            )
        return self

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "gender": "Male",
                    "SeniorCitizen": 0,
                    "Partner": "No",
                    "Dependents": "No",
                    "tenure": 2,
                    "PhoneService": "Yes",
                    "MultipleLines": "No",
                    "InternetService": "Fiber optic",
                    "OnlineSecurity": "No",
                    "OnlineBackup": "No",
                    "DeviceProtection": "No",
                    "TechSupport": "No",
                    "StreamingTV": "Yes",
                    "StreamingMovies": "Yes",
                    "Contract": "Month-to-month",
                    "PaperlessBilling": "Yes",
                    "PaymentMethod": "Electronic check",
                    "MonthlyCharges": 95.0,
                }
            ]
        }
    }


class Driver(BaseModel):
    feature: str
    value: Union[str, int, float]
    impact: float = Field(
        description="Log-odds contribution; positive raises churn risk"
    )


class PredictionResponse(BaseModel):
    churn_probability: float
    churn_flag: bool
    risk_level: Literal["low", "medium", "high"]
    threshold: float
    model_name: str
    drivers: list[Driver]


# ----------------------------------------------------------------------------
# App + model loading
# ----------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    if not MODEL_PATH.exists():
        raise RuntimeError(
            f"Model file not found: {MODEL_PATH}\n"
            "Download 'churn_lr_pipeline.joblib' from your notebook (Section 11) "
            "and put it next to main.py, or set the MODEL_PATH environment variable."
        )
    artifact = joblib.load(MODEL_PATH)
    pipeline = artifact["pipeline"]

    feature_names = list(
        getattr(pipeline, "feature_names_in_", CustomerFeatures.model_fields)
    )
    unknown = set(feature_names) - set(CustomerFeatures.model_fields)
    if unknown:
        raise RuntimeError(
            f"The model expects columns the API does not define: {sorted(unknown)}. "
            "Update CustomerFeatures in main.py."
        )

    app.state.pipeline = pipeline
    app.state.threshold = float(artifact["threshold"])
    app.state.model_name = str(artifact.get("model_name", "Logistic Regression"))
    app.state.feature_names = feature_names
    yield


app = FastAPI(
    title="Telecom Churn Prediction API",
    description="Predicts customer churn risk with the final Logistic Regression pipeline.",
    version="1.0.0",
    lifespan=lifespan,
)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    """Return short, readable validation errors instead of FastAPI's verbose default."""
    errors = []
    for err in exc.errors():
        loc = [str(p) for p in err["loc"] if p != "body"]
        message = str(err["msg"]).removeprefix("Value error, ")
        errors.append({"field": ".".join(loc) or None, "message": message})
    return JSONResponse(status_code=422, content={"detail": errors})


# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------
def risk_level(probability: float, threshold: float) -> str:
    if probability >= threshold:
        return "high"
    if probability >= 0.6 * threshold:
        return "medium"
    return "low"


def explain(pipeline, frame: pd.DataFrame, inputs: dict) -> list[dict]:
    """
    Per-feature contribution to the log-odds (coefficient x transformed value),
    summed over each feature's one-hot columns. Only possible for linear models.
    One-hot features are measured against their dropped baseline category, and
    numeric features against the average customer (they are standardized).
    """
    clf = pipeline.named_steps["clf"]
    if not hasattr(clf, "coef_"):
        return []

    prep = pipeline.named_steps["prep"]
    transformed = prep.transform(frame)
    if hasattr(transformed, "toarray"):
        transformed = transformed.toarray()
    row = np.asarray(transformed)[0]
    contributions = row * clf.coef_[0]

    originals = list(frame.columns)
    grouped = {col: 0.0 for col in originals}
    for name, value in zip(prep.get_feature_names_out(), contributions):
        matches = [c for c in originals if name == c or name.startswith(c + "_")]
        if matches:
            grouped[max(matches, key=len)] += float(value)

    drivers = [
        {"feature": col, "value": inputs[col], "impact": round(impact, 4)}
        for col, impact in grouped.items()
    ]
    return sorted(drivers, key=lambda d: abs(d["impact"]), reverse=True)


# ----------------------------------------------------------------------------
# API routes
# ----------------------------------------------------------------------------
@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "model": app.state.model_name,
        "threshold": app.state.threshold,
    }


@app.get("/api/model-info")
def model_info():
    return {
        "model_name": app.state.model_name,
        "threshold": app.state.threshold,
        "features": app.state.feature_names,
        "metrics": MODEL_METRICS,
    }


@app.post("/api/predict", response_model=PredictionResponse)
def predict(customer: CustomerFeatures):
    inputs = customer.model_dump()
    frame = pd.DataFrame([inputs])[app.state.feature_names]
    probability = float(app.state.pipeline.predict_proba(frame)[0, 1])
    threshold = app.state.threshold

    return PredictionResponse(
        churn_probability=round(probability, 4),
        churn_flag=probability >= threshold,
        risk_level=risk_level(probability, threshold),
        threshold=threshold,
        model_name=app.state.model_name,
        drivers=explain(app.state.pipeline, frame, inputs),
    )


# ----------------------------------------------------------------------------
# Website
# ----------------------------------------------------------------------------
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(STATIC_DIR / "index.html")
