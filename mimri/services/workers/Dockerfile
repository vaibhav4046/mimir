FROM python:3.13-slim
WORKDIR /app
COPY . /app
CMD ["python", "-m", "unittest", "discover", "-s", "tests", "-p", "test_*.py"]
