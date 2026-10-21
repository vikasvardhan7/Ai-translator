from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.models.trainer import FoodGuess, WorkoutPlan
from app.services.trainer import store as store_module
from tests.conftest import TEST_HOST, THIS_COMPUTER, make_client
from tests.fakes import LibraryServer, fake_library
from tests.test_account import PASSWORD, code_in
from tests.test_trainer import PROFILE, TODAY, signed_in, workout_plan

JPEG = b"\xff\xd8\xff\xe0" + b"meal" * 50
PNG = b"\x89PNG\r\n\x1a\n" + b"body" * 50
WEBP = b"RIFF\x00\x00\x00\x00WEBP" + b"x" * 20
MEAL = {
    "kind": "meal",
    "meal": "Lunch",
    "food": "Rice, 1 cup",
    "calories": 200,
    "protein_g": 4,
    "carbs_g": 45,
    "fat_g": 0.5,
}


def upload(client, data: bytes = JPEG, kind: str = "meal", day=TODAY):
    return client.post(
        f"/api/trainer/photos?day={day.isoformat()}&kind={kind}",
        content=data,
        headers={"Content-Type": "image/jpeg"},
    )


def second_person(client):
    other = TestClient(client.app, base_url=f"http://{TEST_HOST}", client=THIS_COMPUTER)
    mailer = client.app.state.mailer
    other.post("/api/account/code", json={"email": "sita@example.com", "purpose": "sign_up"})
    other.post(
        "/api/account/sign-up",
        json={
            "email": "sita@example.com",
            "code": code_in(mailer),
            "name": "Sita",
            "password": PASSWORD,
        },
    )
    assert other.get("/api/account").json()["email"] == "sita@example.com"
    return other


def test_the_exercise_library_needs_an_account_and_lists_every_exercise() -> None:
    client, _ = signed_in()
    stranger = make_client()

    listed = client.get("/api/trainer/exercises")
    one = client.get("/api/trainer/exercises/Leg_Press")

    assert stranger.get("/api/trainer/exercises").status_code == 401
    assert listed.status_code == 200
    cards = listed.json()["exercises"]
    assert len(cards) == 8 and "instructions" not in cards[0]
    assert listed.json()["source"].startswith("https://")
    assert one.json()["instructions"] == ["Stand tall.", "Move with control."]
    assert one.json()["primary"] == ["quadriceps"]
    assert client.get("/api/trainer/exercises/Nothing").status_code == 404


def test_a_library_that_cannot_be_reached_is_explained() -> None:
    client, _ = signed_in()
    client.app.state.exercise_library = fake_library(LibraryServer(status=500))

    answer = client.get("/api/trainer/exercises")

    assert answer.status_code == 503
    assert "internet connection" in answer.json()["detail"]


def test_plans_are_made_from_the_library_and_linked_to_it() -> None:
    client, coach = signed_in()
    client.put("/api/trainer/profile", json={**PROFILE, "equipment": "bodyweight"})

    made = client.post("/api/trainer/plans/workout", json={}).json()

    exercise = made["workout"]["days"][0]["exercises"][0]
    assert exercise["name"] == "Goblet squat"
    assert exercise["library_id"] == "Goblet_Squat"
    assert {item.id for item in coach.library_seen} == {"Pushups", "Plank"}


def test_edited_plans_are_linked_to_the_library_too() -> None:
    client, _ = signed_in()
    client.put("/api/trainer/profile", json=PROFILE)
    plan = workout_plan().model_dump(mode="json")
    plan["days"][0]["exercises"] = [
        {"name": "Push-up", "sets": 3, "reps": "10", "rest_seconds": 60},
        {"name": "Zumba", "sets": 1, "reps": "20 min", "rest_seconds": 0, "library_id": "Nope"},
        {"name": "My squat", "sets": 3, "reps": "8", "rest_seconds": 90, "library_id": "Leg_Press"},
    ]

    saved = client.put("/api/trainer/plans/workout", json=plan).json()

    ids = [e["library_id"] for e in saved["workout"]["days"][0]["exercises"]]
    assert ids == ["Pushups", "", "Leg_Press"]


def test_plans_still_work_when_the_library_is_down() -> None:
    client, coach = signed_in()
    client.app.state.exercise_library = fake_library(LibraryServer(status=500))
    client.put("/api/trainer/profile", json=PROFILE)

    made = client.post("/api/trainer/plans/workout", json={})

    assert made.status_code == 200
    assert coach.library_seen == []
    assert made.json()["workout"]["days"][0]["exercises"][0]["library_id"] == ""


def test_photos_are_kept_for_their_owner_only() -> None:
    client, _ = signed_in()
    added = upload(client, PNG, kind="body")
    photo_id = added.json()["id"]
    other = second_person(client)

    shown = client.get(f"/api/trainer/photos/{photo_id}")

    assert added.status_code == 201
    assert added.json()["kind"] == "body" and added.json()["size"] == len(PNG)
    assert shown.content == PNG
    assert shown.headers["content-type"] == "image/png"
    assert shown.headers["x-content-type-options"] == "nosniff"
    assert other.get(f"/api/trainer/photos/{photo_id}").status_code == 404
    assert other.delete(f"/api/trainer/photos/{photo_id}").status_code == 404
    assert make_client().get(f"/api/trainer/photos/{photo_id}").status_code == 401


def test_only_real_pictures_of_a_sensible_size_are_taken(monkeypatch) -> None:
    client, _ = signed_in()
    monkeypatch.setattr("app.api.trainer.MAX_PHOTO_BYTES", 300)

    text = upload(client, b"not a picture at all")
    big = upload(client, JPEG + b"x" * 300)
    webp = upload(client, WEBP)
    far = upload(client, JPEG, day=TODAY - timedelta(days=4000))
    wrong_kind = upload(client, JPEG, kind="selfie")

    assert text.status_code == 415
    assert big.status_code == 413
    assert webp.status_code == 201
    assert far.status_code == 422
    assert wrong_kind.status_code == 422


def test_progress_photos_are_listed_newest_first_and_can_be_deleted() -> None:
    client, _ = signed_in()
    first = upload(client, PNG, kind="body", day=TODAY - timedelta(days=7)).json()["id"]
    second = upload(client, PNG, kind="body").json()["id"]
    upload(client, JPEG, kind="meal")

    listed = client.get("/api/trainer/photos?kind=body").json()["photos"]
    removed = client.delete(f"/api/trainer/photos/{first}")

    assert [photo["id"] for photo in listed] == [second, first]
    assert removed.status_code == 204
    assert client.get(f"/api/trainer/photos/{first}").status_code == 404
    assert client.delete("/api/trainer/photos/not-an-id").status_code == 422


def test_a_food_photo_is_estimated_and_stays_with_the_meal() -> None:
    client, coach = signed_in()
    coach.food_items = [
        FoodGuess(
            food="Rice",
            grams=150,
            calories_100g=130,
            protein_100g=2.7,
            carbs_100g=28,
            fat_100g=0.3,
        )
    ]
    photo_id = upload(client).json()["id"]

    found = client.post("/api/trainer/foods", json={"photo_id": photo_id, "text": "lunch"})
    entry = client.post(
        f"/api/trainer/days/{TODAY}/entries", json={"data": {**MEAL, "photo_id": photo_id}}
    )
    busy = client.delete(f"/api/trainer/photos/{photo_id}")
    client.delete(f"/api/trainer/entries/{entry.json()['id']}")

    assert found.json()["items"][0]["grams"] == 150
    assert coach.asked[-1] == ("foods", "lunch", ("image/jpeg", JPEG))
    assert entry.status_code == 201 and entry.json()["data"]["photo_id"] == photo_id
    assert busy.status_code == 409
    assert client.get(f"/api/trainer/photos/{photo_id}").status_code == 404


def test_a_photo_shared_by_two_foods_stays_until_both_are_removed() -> None:
    client, _ = signed_in()
    photo_id = upload(client).json()["id"]
    first, second = (
        client.post(
            f"/api/trainer/days/{TODAY}/entries",
            json={"data": {**MEAL, "food": food, "photo_id": photo_id}},
        ).json()["id"]
        for food in ("Rice", "Dal")
    )

    client.delete(f"/api/trainer/entries/{first}")
    kept = client.get(f"/api/trainer/photos/{photo_id}").status_code
    client.delete(f"/api/trainer/entries/{second}")

    assert kept == 200
    assert client.get(f"/api/trainer/photos/{photo_id}").status_code == 404


def test_meals_can_only_use_your_own_meal_photos() -> None:
    client, _ = signed_in()
    body_photo = upload(client, PNG, kind="body").json()["id"]
    other = second_person(client)
    theirs = upload(other).json()["id"]

    with_body = client.post(
        f"/api/trainer/days/{TODAY}/entries", json={"data": {**MEAL, "photo_id": body_photo}}
    )
    with_theirs = client.post(
        f"/api/trainer/days/{TODAY}/entries", json={"data": {**MEAL, "photo_id": theirs}}
    )
    estimate = client.post("/api/trainer/foods", json={"photo_id": theirs})

    assert with_body.status_code == 404
    assert with_theirs.status_code == 404
    assert estimate.status_code == 404


def test_foods_need_words_or_a_photo() -> None:
    client, _ = signed_in()

    answer = client.post("/api/trainer/foods", json={"text": ""})

    assert answer.status_code == 422
    assert "photo" in answer.json()["detail"]


def test_unused_meal_photos_are_cleared_after_a_day(monkeypatch) -> None:
    client, _ = signed_in()
    yesterday = datetime.now(UTC) - timedelta(days=2)
    monkeypatch.setattr(store_module, "_now", lambda: yesterday)
    old_meal = upload(client).json()["id"]
    old_body = upload(client, PNG, kind="body").json()["id"]
    monkeypatch.undo()

    upload(client)

    assert client.get(f"/api/trainer/photos/{old_meal}").status_code == 404
    assert client.get(f"/api/trainer/photos/{old_body}").status_code == 200


def test_there_is_a_daily_photo_limit(monkeypatch) -> None:
    client, _ = signed_in()
    monkeypatch.setattr(store_module, "MAX_PHOTOS_PER_DAY", 2)

    answers = [upload(client).status_code for _ in range(3)]
    tomorrow = upload(client, day=TODAY - timedelta(days=1)).status_code

    assert answers == [201, 201, 409]
    assert tomorrow == 201


def test_photos_are_in_the_download_and_deleted_with_the_data() -> None:
    client, _ = signed_in()
    photo_id = upload(client, PNG, kind="body").json()["id"]

    exported = client.get("/api/trainer/export").json()
    client.delete("/api/trainer")

    assert [photo["id"] for photo in exported["photos"]] == [photo_id]
    assert client.get(f"/api/trainer/photos/{photo_id}").status_code == 404


def test_the_coach_can_show_exercises_start_a_workout_and_open_pages() -> None:
    client, coach = signed_in()
    client.put("/api/trainer/profile", json=PROFILE)
    coach.answer = ""
    coach.actions = (
        {"kind": "show_exercise", "name": "leg press"},
        {"kind": "open_page", "page": "admin"},
        {"kind": "start_workout"},
        {"kind": "open_page", "page": "diet"},
    )

    reply = client.post(
        "/api/trainer/coach",
        json={
            "messages": [{"role": "user", "text": "How do I do a leg press?"}],
            "day": str(TODAY),
        },
    ).json()

    assert reply["answer"] == "Here you go."
    assert reply["actions"] == [
        {"kind": "show_exercise", "exercise_id": "Leg_Press", "query": "leg press", "page": None},
        {"kind": "start_workout", "exercise_id": None, "query": None, "page": None},
    ]


@pytest.mark.parametrize("server", [LibraryServer(), LibraryServer(status=500)])
def test_an_exercise_the_library_lacks_is_searched_for_instead(server) -> None:
    client, coach = signed_in()
    client.app.state.exercise_library = fake_library(server)
    coach.actions = ({"kind": "show_exercise", "name": "Zumba"}, {"kind": "show_exercise"})

    reply = client.post(
        "/api/trainer/coach",
        json={"messages": [{"role": "user", "text": "Show zumba"}], "day": str(TODAY)},
    ).json()

    assert reply["answer"] == "Great work today."
    assert reply["actions"] == [
        {"kind": "show_exercise", "exercise_id": None, "query": "Zumba", "page": None}
    ]


def test_a_coach_answer_with_nothing_valid_says_so() -> None:
    client, coach = signed_in()
    coach.answer = ""
    coach.logs = ({"kind": "water", "ml": -5},)

    reply = client.post(
        "/api/trainer/coach",
        json={"messages": [{"role": "user", "text": "I drank water"}], "day": str(TODAY)},
    ).json()

    assert reply["logged"] == []
    assert "could not be logged" in reply["answer"]


def test_old_plans_without_library_links_still_load() -> None:
    plan = WorkoutPlan.model_validate(
        {
            **workout_plan().model_dump(mode="json"),
            "days": [
                {
                    **day,
                    "exercises": [
                        {k: v for k, v in e.items() if k != "library_id"} for e in day["exercises"]
                    ],
                }
                for day in workout_plan().model_dump(mode="json")["days"]
            ],
        }
    )

    assert plan.days[0].exercises[0].library_id == ""
