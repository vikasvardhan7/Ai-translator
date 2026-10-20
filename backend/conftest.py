import os

for name in ("GEMINI_API_KEY", "GEMINI_MODEL", "GEMINI_TTS_MODEL", "GEMINI_ASSISTANT_MODEL"):
    os.environ[name] = ""
