FROM python:3.13-slim
WORKDIR /app
COPY . /app
CMD ["python", "-c", "from services.voice.room_worker import LiveKitPipecatWorker; w=LiveKitPipecatWorker(); print(w.room_name)"]
