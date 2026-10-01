# Churn Rate Prediction for Telecom Companies

An end-to-end machine learning web application that predicts customer churn risk for telecom subscribers. Built with a **FastAPI** backend serving a **Logistic Regression** pipeline, paired with a live, interactive website where every input change re-scores the customer in real time.

---

## 📋 Overview

This project takes a trained scikit-learn pipeline (saved as `churn_lr_pipeline.joblib`) and exposes it through a FastAPI backend. The frontend is a lightweight, dependency-free website (vanilla HTML/CSS/JS) that calls the API on every input change, so users see the churn risk score update instantly.

**Key features:**
- Real-time churn risk scoring via `POST /api/predict`
- Verdict threshold slider (client-side only — no server round-trip)
- Per-feature risk drivers explaining each prediction
- Input validation with clear `422` error messages
- Health and model-info endpoints
- Zero frontend build step — just static files

---

## 🗂️ Project Structure

```
churn-app/
├── main.py                     # FastAPI backend + prediction endpoint
├── requirements.txt            # Python dependencies
├── churn_lr_pipeline.joblib    # Trained model (from notebook Section 11)
├── README.md
└── static/
    ├── index.html              # Live prediction website
    ├── style.css               # Styling
    └── script.js               # Client-side logic (API calls, threshold slider)
```

> **Note:** `churn_lr_pipeline.joblib` is not included in the repository (see [Model File](#-model-file) below). You must generate it from the training notebook.

---

## 🚀 Getting Started

### Prerequisites

- Python 3.10+ (tested on 3.12)
- pip

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/<your-username>/churn-rate-prediction.git
   cd churn-rate-prediction
   ```

2. **Create and activate a virtual environment:**
   ```bash
   python -m venv venv

   # Windows
   venv\Scripts\activate

   # macOS / Linux
   source venv/bin/activate
   ```

3. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

### ⚠️ Critical: Match scikit-learn Versions

This project is **highly sensitive to the scikit-learn version**. The `.joblib` file must be saved with the **exact same version** that loads it.

The `multi_class` attribute was removed in scikit-learn 1.7. If you see an error like:

```
AttributeError: 'LogisticRegression' object has no attribute 'multi_class'
```

…it means the model file was saved with a different version than the one in your environment. **Fix:** retrain and re-save the model in your local environment (see below).

To verify your version:
```bash
pip show scikit-learn
```

### Model File

The `churn_lr_pipeline.joblib` file is generated from the training notebook. To create it:

1. Open the training notebook (`Customer_Churn_Prediction.ipynb`) in **the same environment** you'll run the app in.
2. Run all training cells.
3. Run the **Section 11 save cell** to produce `churn_lr_pipeline.joblib`.
4. Place the file next to `main.py`.

This guarantees the model file and the runtime environment use the identical scikit-learn version.

### Running the App

```bash
uvicorn main:app --reload
```

Then open:

- **Website:** http://127.0.0.1:8000
- **API docs (Swagger UI):** http://127.0.0.1:8000/docs

> ⚠️ **Important:** Open the site through `http://127.0.0.1:8000`, **not** by double-clicking `index.html`. The API and the page are served together — a mismatch causes a version warning or a load error.

---

## 🔌 API Reference

### `POST /api/predict`

Scores a single customer.

**Request body:**
```json
{
  "gender": "Female",
  "senior_citizen": 0,
  "partner": "Yes",
  "dependents": "No",
  "tenure": 12,
  "phone_service": "Yes",
  "multiple_lines": "No",
  "internet_service": "Fiber optic",
  "online_security": "No",
  "online_backup": "Yes",
  "device_protection": "No",
  "tech_support": "No",
  "streaming_tv": "Yes",
  "streaming_movies": "No",
  "contract": "Month-to-month",
  "paperless_billing": "Yes",
  "payment_method": "Electronic check",
  "monthly_charges": 70.35,
  "total_charges": 844.2
}
```

**Response:**
```json
{
  "churn_probability": 0.8421,
  "churn_flag": true,
  "risk_level": "High",
  "threshold": 0.29,
  "model_name": "LogisticRegression",
  "drivers": [
    { "feature": "Contract_Month-to-month", "impact": 0.31 },
    { "feature": "InternetService_Fiber optic", "impact": 0.22 }
  ]
}
```

**Validation:** Invalid categories, out-of-range numbers, and contradictory combinations (e.g. `internet_service = "No"` but `streaming_tv = "Yes"`) return a clear `422` error with a descriptive message.

### `GET /api/health`

Returns the API and model status.

### `GET /api/model-info`

Returns the model status, decision threshold, and the metrics copied from the training notebook (`MODEL_METRICS` in `main.py`).

---

## 📊 Model Metrics

Metrics below are copied from the training notebook into `MODEL_METRICS` in `main.py`:

| Metric      | Value   |
|-------------|---------|
| ROC-AUC     | 0.839   |
| Recall      | 93%     |
| Threshold   | 0.29    |

> **Why recall is prioritized:** In churn prediction, missing a churner is typically more expensive than a false alarm. The threshold of `0.29` was chosen to maximize recall.

---

## 🧠 Important Notes on Interpretation

### Call it a "score," not a probability

Because the model uses `class_weight="balanced"`, the output is **not** a calibrated probability. A score of `0.84` does **not** mean 84% of such customers will churn — it means the model ranks this customer high relative to others.

### About risk drivers

- A **month-to-month contract never appears as a risk driver**, because the model measures other contract options *against* it (it's the baseline category).
- Drivers show **relative impact**, not causal effects.

### Metrics are static

The numbers shown in the page header are hardcoded from the notebook into `MODEL_METRICS` in `main.py`. They are not recalculated at runtime.

---

## 🛠️ Tech Stack

| Layer       | Technology                          |
|-------------|-------------------------------------|
| Backend     | FastAPI, Uvicorn                    |
| ML          | scikit-learn, pandas, numpy, joblib |
| Frontend    | Vanilla HTML, CSS, JavaScript       |
| Validation  | Pydantic                            |

---

## 🐛 Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `AttributeError: 'LogisticRegression' object has no attribute 'multi_class'` | Model saved with a different scikit-learn version | Retrain and re-save the model in your local environment |
| Version warning on page load | Opening `index.html` directly instead of via the server | Visit `http://127.0.0.1:8000` |
| `422` on predict | Invalid or contradictory input | Read the error message — it describes the exact field |
| Model not found | Missing `.joblib` file | Generate it from the notebook (Section 11) |

---

## 🗺️ Roadmap

- [ ] CSV upload for batch scoring of an entire customer list
- [ ] Probability calibration (Platt scaling / isotonic regression)
- [ ] Docker container for reproducible deployment
- [ ] Unit tests for the API and validation layer
- [ ] Persist model metrics dynamically instead of hardcoding

---

## 📄 License

This project is released under the MIT License. See `LICENSE` for details.

---

## 🙏 Acknowledgements

- Dataset: [Telco Customer Churn](https://www.kaggle.com/datasets/blastchar/telco-customer-churn) (IBM Sample Data)
- Built with [FastAPI](https://fastapi.tiangolo.com/) and [scikit-learn](https://scikit-learn.org/)

---

**⭐ If you found this project useful, consider giving it a star!**