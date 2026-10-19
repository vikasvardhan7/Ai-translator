from pydantic import BaseModel


class AccessOut(BaseModel):
    host: bool
