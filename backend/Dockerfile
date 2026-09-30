FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

RUN python -m app.data.generate_data

# Drop root before serving: nothing here needs it, and the named volume at
# app/data/generated (see docker-compose.yml) is chowned now so it's already
# writable by appuser the first time compose populates it from this image.
RUN useradd --create-home --uid 1000 appuser && chown -R appuser:appuser /app
USER appuser

ENV PORT=8000
EXPOSE 8000

# Regenerate the dataset at boot if it's missing — not redundant with the
# build-time RUN above. A Docker named volume (docker-compose.yml) auto-seeds
# itself from the image on first mount, so the build-time copy is enough
# there; a Render (or similar) persistent disk instead mounts *empty* on
# first deploy, silently masking everything the image baked in at that path
# and leaving the app with no data to load. This check makes either case work.
CMD ["sh", "-c", "test -f app/data/generated/phcs.json || python -m app.data.generate_data; uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
