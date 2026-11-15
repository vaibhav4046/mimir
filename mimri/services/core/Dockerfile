FROM python:3.13-slim
WORKDIR /app
COPY . /app
EXPOSE 8080
CMD ["python", "-c", "from pathlib import Path; from services.core.app import serve_http; serve_http(Path('/app'), port=8080)"]
