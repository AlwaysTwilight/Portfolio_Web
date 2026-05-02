FROM python:3.10-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_EXTRA_INDEX_URL=https://download.pytorch.org/whl/cpu
ENV PIP_DISABLE_PIP_VERSION_CHECK=1
ENV PIP_DEFAULT_TIMEOUT=120

WORKDIR /app

COPY requirements.txt .
RUN python -m pip install --no-cache-dir -U pip setuptools wheel
RUN pip install --no-cache-dir --retries 8 --timeout 120 -r requirements.txt

COPY app ./app
COPY ui ./ui
COPY *.md ./
COPY .env.example ./.env.example

EXPOSE 8080

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers"]
