# Alternatief: een vast image bouwen (docker build -t infobord .)
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY infobord ./infobord
ENV INFOBORD_PORT=8080 INFOBORD_DATA=/data TZ=Europe/Amsterdam
VOLUME /data
EXPOSE 8080
CMD ["python", "-m", "infobord"]
