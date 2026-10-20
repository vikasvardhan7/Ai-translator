import logging
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from app.api.dependencies import (
    client_address,
    get_account_store,
    get_mailer,
    get_meeting_store,
    is_owner,
    require_user,
    use_allowance,
)
from app.core.access import SESSION_COOKIE
from app.models.account import (
    CodeRequest,
    CodeSent,
    Goodbye,
    PasswordChange,
    Rename,
    Reset,
    SignIn,
    SignUp,
    UserOut,
)
from app.services.account_store import (
    CODE_GAP,
    CODE_LIFETIME,
    AccountExists,
    AccountLimitReached,
    AccountStore,
    CodeRefused,
    CodeTooSoon,
    User,
    masked_email,
)
from app.services.limits import Allowance
from app.services.mailer import Mailer, MailFailed
from app.services.meeting_store import MeetingStore

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/account", tags=["account"])

Accounts = Annotated[AccountStore, Depends(get_account_store)]
Signed = Annotated[User, Depends(require_user)]
MailerOrNone = Annotated[Mailer | None, Depends(get_mailer)]
Meetings = Annotated[MeetingStore, Depends(get_meeting_store)]

PER_ADDRESS = Allowance(per_minute=20, per_day=300)
PER_EMAIL = {
    "code": Allowance(per_minute=10, per_day=40),
    "sign-in": Allowance(per_minute=5, per_day=30),
}
WRONG_CODE = "That code is wrong or has expired. Ask for a new one."
WRONG_PASSWORD = "The email or the password is wrong."
NO_EMAIL = (
    "Sending email is not set up yet. Add SMTP_USERNAME and SMTP_PASSWORD (a Gmail app password)"
    " to backend/.env and start the backend again."
)
SAME_AS_EMAIL = "Choose a password that is not your email address."


def _kind_of(subject: str) -> str:
    return "they already have an account" if subject.startswith("You already") else "a code"


def _guard(request: Request, email: str, kind: str = "code") -> None:
    use_allowance(request, f"auth-address:{client_address(request)}", PER_ADDRESS, "This device")
    use_allowance(request, f"auth-{kind}:{email}", PER_EMAIL[kind], "This email address")


def _secure(request: Request) -> bool:
    return request.headers.get("x-forwarded-proto", request.url.scheme) == "https"


def _out(request: Request, user: User) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        name=user.name,
        created_at=user.created_at,
        owner=is_owner(request),
    )


def _signed_in(request: Request, response: Response, accounts: AccountStore, user: User) -> UserOut:
    response.set_cookie(
        SESSION_COOKIE,
        accounts.start_session(user.id),
        httponly=True,
        samesite="lax",
        secure=_secure(request),
        path="/",
    )
    return _out(request, user)


def _password_is_fine(email: str, password: str) -> None:
    if password.strip().lower() == email:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, SAME_AS_EMAIL)


@router.get("", response_model=UserOut)
async def me(request: Request, user: Signed) -> UserOut:
    return _out(request, user)


@router.post("/code", response_model=CodeSent, status_code=status.HTTP_202_ACCEPTED)
async def send_code(
    body: CodeRequest, request: Request, accounts: Accounts, mailer: MailerOrNone
) -> CodeSent:
    _guard(request, body.email)
    if mailer is None:
        logger.warning("Code not sent to %s: email is not set up", masked_email(body.email))
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, NO_EMAIL)
    existing = accounts.find_by_email(body.email)
    minutes = int(CODE_LIFETIME / timedelta(minutes=1))
    try:
        if body.purpose == "sign_up" and existing is not None:
            subject = "You already have an account"
            text = (
                "Someone asked to create an account with this email address, but you already"
                " have one. Sign in, or choose Forgot password to set a new password. If it"
                " was not you, ignore this email."
            )
        elif body.purpose == "reset" and existing is None:
            return CodeSent(
                sent=True, resend_after=int(CODE_GAP.total_seconds()), expires_in=minutes * 60
            )
        else:
            code = accounts.new_code(body.email, body.purpose)
            action = "create your account" if body.purpose == "sign_up" else "set a new password"
            subject = f"Your code is {code}"
            text = (
                f"Your code to {action} is {code}. It works for {minutes} minutes."
                " If you did not ask for it, ignore this email; nobody can sign in without it."
            )
        await mailer.send(body.email, subject, text)
        logger.info("Account email sent to %s: %s", masked_email(body.email), _kind_of(subject))
    except CodeTooSoon as exc:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"A code was just sent. Wait {exc.wait_seconds} s before asking for another.",
            headers={"Retry-After": str(exc.wait_seconds)},
        ) from exc
    except MailFailed as exc:
        logger.warning("Code not sent to %s: %s (%s)", masked_email(body.email), exc, exc.detail)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    return CodeSent(sent=True, resend_after=int(CODE_GAP.total_seconds()), expires_in=minutes * 60)


@router.post("/sign-up", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def sign_up(
    body: SignUp, request: Request, response: Response, accounts: Accounts
) -> UserOut:
    _guard(request, body.email)
    _password_is_fine(body.email, body.password)
    try:
        accounts.use_code(body.email, "sign_up", body.code)
        user = accounts.create(body.email, body.name, body.password)
    except CodeRefused as exc:
        logger.info("Sign-up refused for %s: wrong or old code", masked_email(body.email))
        raise HTTPException(status.HTTP_400_BAD_REQUEST, WRONG_CODE) from exc
    except AccountExists as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "There is already an account with this email. Sign in."
        ) from exc
    except AccountLimitReached as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "No more accounts can be made on this app."
        ) from exc
    logger.info("Account created for %s", masked_email(user.email))
    return _signed_in(request, response, accounts, user)


@router.post("/sign-in", response_model=UserOut)
async def sign_in(
    body: SignIn, request: Request, response: Response, accounts: Accounts
) -> UserOut:
    _guard(request, body.email, "sign-in")
    user = accounts.check_password(body.email, body.password)
    if user is None:
        reason = (
            "no account has this email yet (Create account first)"
            if accounts.find_by_email(body.email) is None
            else "wrong password"
        )
        logger.info("Sign-in refused for %s: %s", masked_email(body.email), reason)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, WRONG_PASSWORD)
    return _signed_in(request, response, accounts, user)


@router.post("/reset", response_model=UserOut)
async def reset(body: Reset, request: Request, response: Response, accounts: Accounts) -> UserOut:
    _guard(request, body.email)
    _password_is_fine(body.email, body.password)
    try:
        accounts.use_code(body.email, "reset", body.code)
    except CodeRefused as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, WRONG_CODE) from exc
    user = accounts.find_by_email(body.email)
    if user is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, WRONG_CODE)
    accounts.set_password(user.id, body.password)
    return _signed_in(request, response, accounts, user)


@router.post("/sign-out", status_code=status.HTTP_204_NO_CONTENT)
async def sign_out(request: Request, response: Response, accounts: Accounts) -> None:
    accounts.end_session(request.cookies.get(SESSION_COOKIE, ""))
    response.delete_cookie(SESSION_COOKIE, path="/", secure=_secure(request), samesite="lax")


@router.put("/password", response_model=UserOut)
async def change_password(
    body: PasswordChange, request: Request, response: Response, accounts: Accounts, user: Signed
) -> UserOut:
    _guard(request, user.email, "sign-in")
    if not accounts.password_ok(user, body.current):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "The current password is wrong.")
    _password_is_fine(user.email, body.password)
    accounts.set_password(user.id, body.password)
    return _signed_in(request, response, accounts, user)


@router.put("/name", response_model=UserOut)
async def rename(body: Rename, request: Request, accounts: Accounts, user: Signed) -> UserOut:
    accounts.rename(user.id, body.name)
    renamed = accounts.get(user.id)
    if renamed is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in first.")
    return _out(request, renamed)


@router.post("/delete", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    body: Goodbye,
    request: Request,
    response: Response,
    accounts: Accounts,
    meetings: Meetings,
    user: Signed,
) -> None:
    _guard(request, user.email, "sign-in")
    if not accounts.password_ok(user, body.password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "The password is wrong.")
    for forget in request.app.state.forget_user:
        forget(user.id)
    meetings.forget_owner(user.id)
    accounts.delete(user.id)
    response.delete_cookie(SESSION_COOKIE, path="/", secure=_secure(request), samesite="lax")
