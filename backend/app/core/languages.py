from dataclasses import dataclass


@dataclass(frozen=True)
class Language:
    code: str
    name: str
    native_name: str


_LANGUAGES: tuple[Language, ...] = (
    Language("ar", "Arabic", "العربية"),
    Language("as", "Assamese", "অসমীয়া"),
    Language("bn", "Bengali", "বাংলা"),
    Language("zh", "Chinese", "中文"),
    Language("nl", "Dutch", "Nederlands"),
    Language("en", "English", "English"),
    Language("fr", "French", "Français"),
    Language("de", "German", "Deutsch"),
    Language("el", "Greek", "Ελληνικά"),
    Language("gu", "Gujarati", "ગુજરાતી"),
    Language("he", "Hebrew", "עברית"),
    Language("hi", "Hindi", "हिन्दी"),
    Language("id", "Indonesian", "Bahasa Indonesia"),
    Language("it", "Italian", "Italiano"),
    Language("ja", "Japanese", "日本語"),
    Language("kn", "Kannada", "ಕನ್ನಡ"),
    Language("ko", "Korean", "한국어"),
    Language("ms", "Malay", "Bahasa Melayu"),
    Language("ml", "Malayalam", "മലയാളം"),
    Language("mr", "Marathi", "मराठी"),
    Language("ne", "Nepali", "नेपाली"),
    Language("or", "Odia", "ଓଡ଼ିଆ"),
    Language("fa", "Persian", "فارسی"),
    Language("pl", "Polish", "Polski"),
    Language("pt", "Portuguese", "Português"),
    Language("pa", "Punjabi", "ਪੰਜਾਬੀ"),
    Language("ru", "Russian", "Русский"),
    Language("si", "Sinhala", "සිංහල"),
    Language("es", "Spanish", "Español"),
    Language("sw", "Swahili", "Kiswahili"),
    Language("sv", "Swedish", "Svenska"),
    Language("ta", "Tamil", "தமிழ்"),
    Language("te", "Telugu", "తెలుగు"),
    Language("th", "Thai", "ไทย"),
    Language("tr", "Turkish", "Türkçe"),
    Language("uk", "Ukrainian", "Українська"),
    Language("ur", "Urdu", "اردو"),
    Language("vi", "Vietnamese", "Tiếng Việt"),
)

_CODES: frozenset[str] = frozenset(lang.code for lang in _LANGUAGES)


def all_languages() -> tuple[Language, ...]:
    return _LANGUAGES


def is_supported(code: str) -> bool:
    return code in _CODES
