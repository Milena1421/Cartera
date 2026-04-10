<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/8e447b0e-6fbd-431e-9290-73130c441b17

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Deploy To Google Cloud Run

This project is ready to run in Cloud Run with Docker.

### Required environment variables

Set these in Cloud Run:

- `GEMINI_API_KEY`
- `VITE_SIIGO_API_URL`
- `VITE_SIIGO_USERNAME`
- `VITE_SIIGO_ACCESS_KEY`

If your frontend build depends on public Vite variables, also provide them during the Docker build:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

### Build locally with Docker

```bash
docker build -t cartera .
docker run --rm -p 8080:8080 \
  -e GEMINI_API_KEY=your_gemini_key \
  -e VITE_SIIGO_API_URL=https://api.siigo.com/v1 \
  -e VITE_SIIGO_USERNAME=your_siigo_user \
  -e VITE_SIIGO_ACCESS_KEY=your_siigo_key \
  cartera
```

### Deploy with gcloud

```bash
gcloud builds submit --tag gcr.io/PROJECT_ID/cartera

gcloud run deploy cartera \
  --image gcr.io/PROJECT_ID/cartera \
  --platform managed \
  --region REGION \
  --allow-unauthenticated \
  --port 8080 \
  --set-env-vars GEMINI_API_KEY=your_gemini_key,VITE_SIIGO_API_URL=https://api.siigo.com/v1,VITE_SIIGO_USERNAME=your_siigo_user,VITE_SIIGO_ACCESS_KEY=your_siigo_key
```

### Health check

The container exposes:

- `GET /healthz`
