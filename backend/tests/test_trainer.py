from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.models.trainer import (
    WEEKDAYS,
    DietDay,
    DietPlan,
    FoodGuess,
    FoodItem,
    Meal,
    Portion,
    WorkoutDay,
    WorkoutPlan,
)
from app.services.trainer.gemini import TrainerFailed
from tests.conftest import ELSEWHERE, TEST_HOST, make_client
from tests.fakes import FakeMailer, FakeTrainer
from tests.test_account import PASSWORD, code_in

TODAY = datetime.now(UTC).date()
PROFILE = {
    "name": "Ravi",
    "age": 30,
    "sex": "male",
    "height_cm": 175,
    "weight_kg": 80,
    "target_weight_kg": 74,
    "goal": "lose_fat",
    "level": "beginner",
    "activity": "moderate",
    "days_per_week": 3,
    "minutes_per_session": 45,
    "equipment": "gym",
    "diet": "vegetarian",
    "cuisine": "South Indian",
    "meals_per_day": 4,
    "allergies": "",
    "health_notes": "",
}


def workout_plan(focus: str = "Full body") -> WorkoutPlan:
    return WorkoutPlan(
        summary="Three full-body days.",
        days=[
            WorkoutDay(
                day=day,
                focus=focus if index % 2 == 0 else "Rest and walk",
                rest=index % 2 == 1,
                exercises=[]
                if index % 2
                else [{"name": "Goblet squat", "sets": 3, "reps": "10-12", "rest_seconds": 90}],
            )
            for index, day in enumerate(WEEKDAYS)
        ],
    )


def diet_plan() -> DietPlan:
    meal = Meal(
        name="Breakfast",
        time="08:00",
        items=[FoodItem(food="Idli", amount="3", calories=180, protein_g=6, carbs_g=36, fat_g=1)],
    )
    return DietPlan(
        summary="Simple meals.", days=[DietDay(day=day, meals=[meal]) for day in WEEKDAYS]
    )


def signed_in(
    email: str = "ravi@example.com", *, here: bool = True
) -> tuple[TestClient, FakeTrainer]:
    mailer = FakeMailer()
    client = make_client(mailer=mailer)
    coach = FakeTrainer(workout=workout_plan(), diet=diet_plan())
    client.app.state.trainer_ai = coach
    person = (
        client if here else TestClient(client.app, base_url=f"http://{TEST_HOST}", client=ELSEWHERE)
    )
    person.post("/api/account/code", json={"email": email, "purpose": "sign_up"})
    person.post(
        "/api/account/sign-up",
        json={"email": email, "code": code_in(mailer), "name": "Ravi", "password": PASSWORD},
    )
    return person, coach


def test_nothing_is_shown_without_signing_in() -> None:
    client = make_client()

    assert client.get("/api/trainer").status_code == 401
    assert client.put("/api/trainer/profile", json=PROFILE).status_code == 401
    assert client.get(f"/api/trainer/days/{TODAY}").status_code == 401


def test_a_saved_profile_gets_daily_targets_from_the_body_numbers() -> None:
    client, _ = signed_in()

    empty = client.get("/api/trainer").json()
    saved = client.put("/api/trainer/profile", json=PROFILE).json()

    assert empty == {
        "profile": None,
        "targets": None,
        "workout": None,
        "diet": None,
        "coach_ready": True,
    }
    targets = saved["targets"]
    assert targets["resting_calories"] == 1750
    assert targets["daily_burn"] == 2710
    assert targets["calories"] == 2170
    assert targets["protein_g"] == 160
    assert targets["water_ml"] == 2750
    assert "Mifflin-St Jeor" in targets["explanation"]


def test_a_teenager_is_never_given_a_calorie_cut() -> None:
    client, _ = signed_in()

    targets = client.put("/api/trainer/profile", json={**PROFILE, "age": 16}).json()["targets"]

    assert targets["calories"] == targets["daily_burn"]
    assert "Under 18" in targets["explanation"]


@pytest.mark.parametrize(
    "change",
    [{"age": 9}, {"weight_kg": 10}, {"goal": "teleport"}, {"days_per_week": 8}, {"pets": 2}],
    ids=["too-young", "weight", "goal", "days", "unknown"],
)
def test_a_profile_must_make_sense(change: dict) -> None:
    client, _ = signed_in()

    assert client.put("/api/trainer/profile", json={**PROFILE, **change}).status_code == 422


def test_plans_need_a_profile_and_are_made_by_the_ai_then_kept() -> None:
    client, coach = signed_in()

    early = client.post("/api/trainer/plans/workout", json={})
    client.put("/api/trainer/profile", json=PROFILE)
    workout = client.post("/api/trainer/plans/workout", json={"wishes": "No running"})
    diet = client.post("/api/trainer/plans/diet", json={})
    again = client.get("/api/trainer").json()

    assert early.status_code == 409
    assert workout.status_code == 200 and diet.status_code == 200
    assert [day["day"] for day in again["workout"]["days"]] == list(WEEKDAYS)
    assert again["diet"]["days"][0]["meals"][0]["items"][0]["food"] == "Idli"
    assert coach.asked[0] == ("workout", "No running", None, None)


def test_one_day_can_be_made_again_with_a_wish() -> None:
    client, coach = signed_in()
    client.put("/api/trainer/profile", json=PROFILE)
    client.post("/api/trainer/plans/workout", json={})

    client.post("/api/trainer/plans/workout", json={"wishes": "Knee hurts", "day": "monday"})

    kind, wishes, current, day = coach.asked[-1]
    assert (kind, wishes, day) == ("workout", "Knee hurts", "monday")
    assert current.days[0].exercises[0].name == "Goblet squat"
    assert current.days[0].focus == workout_plan().days[0].focus


def test_the_person_can_edit_a_plan_but_it_must_cover_the_week() -> None:
    client, _ = signed_in()
    edited = workout_plan("Upper body").model_dump(mode="json")
    short = {**edited, "days": edited["days"][:6]}

    saved = client.put("/api/trainer/plans/workout", json=edited)
    refused = client.put("/api/trainer/plans/workout", json=short)

    assert saved.json()["workout"]["days"][0]["focus"] == "Upper body"
    assert refused.status_code == 422
    assert "each day of the week" in refused.json()["detail"]


def test_without_the_ai_the_reason_is_given() -> None:
    client, _ = signed_in()
    client.app.state.trainer_ai = None
    client.put("/api/trainer/profile", json=PROFILE)

    response = client.post("/api/trainer/plans/diet", json={})

    assert response.status_code == 503
    assert "GEMINI_API_KEY" in response.json()["detail"]
    assert client.get("/api/trainer").json()["coach_ready"] is False


def test_an_ai_failure_is_explained() -> None:
    client, coach = signed_in()
    client.put("/api/trainer/profile", json=PROFILE)
    coach.failure = TrainerFailed(
        "The free AI limit was reached. Wait a minute and try again.", retryable=True
    )

    response = client.post("/api/trainer/plans/workout", json={})

    assert (response.status_code, response.json()["detail"]) == (
        503,
        "The free AI limit was reached. Wait a minute and try again.",
    )


def test_each_day_is_tracked_and_added_up() -> None:
    client, _ = signed_in()
    entries = [
        {"kind": "exercise", "name": "Goblet squat", "sets": 3, "reps": 12, "weight_kg": 16},
        {"kind": "exercise", "name": "goblet squat", "sets": 2, "reps": 10},
        {
            "kind": "meal",
            "meal": "Breakfast",
            "food": "3 idli",
            "calories": 180,
            "protein_g": 6,
            "carbs_g": 36,
            "fat_g": 1,
        },
        {
            "kind": "meal",
            "meal": "Lunch",
            "food": "Rice and dal",
            "calories": 520,
            "protein_g": 18.5,
        },
        {"kind": "water", "ml": 500},
        {"kind": "water", "ml": 750},
        {"kind": "weight", "kg": 79.6},
        {"kind": "sleep", "hours": 7.5},
        {"kind": "steps", "count": 8200},
        {"kind": "note", "text": "Felt strong"},
    ]

    for data in entries:
        assert (
            client.post(f"/api/trainer/days/{TODAY}/entries", json={"data": data}).status_code
            == 201
        )
    day = client.get(f"/api/trainer/days/{TODAY}").json()

    assert [entry["data"]["kind"] for entry in day["entries"]] == [e["kind"] for e in entries]
    assert day["summary"] == {
        "day": TODAY.isoformat(),
        "calories": 700,
        "protein_g": 24.5,
        "carbs_g": 36.0,
        "fat_g": 1.0,
        "water_ml": 1250,
        "exercises": 1,
        "sets": 5,
        "weight_kg": 79.6,
        "sleep_hours": 7.5,
        "steps": 8200,
    }


def test_an_entry_can_be_removed_only_by_its_owner() -> None:
    client, _ = signed_in()
    other, _ = signed_in("other@example.com")
    entry = client.post(
        f"/api/trainer/days/{TODAY}/entries", json={"data": {"kind": "water", "ml": 250}}
    ).json()

    assert other.delete(f"/api/trainer/entries/{entry['id']}").status_code == 404
    assert client.delete(f"/api/trainer/entries/{entry['id']}").status_code == 204
    assert client.get(f"/api/trainer/days/{TODAY}").json()["entries"] == []


@pytest.mark.parametrize(
    "data",
    [
        {"kind": "water", "ml": 0},
        {"kind": "weight", "kg": 5},
        {"kind": "dance", "minutes": 10},
        {"kind": "meal", "meal": "Lunch", "food": "x", "calories": -1},
    ],
    ids=["no-water", "weight", "unknown-kind", "negative-calories"],
)
def test_entries_must_make_sense(data: dict) -> None:
    client, _ = signed_in()

    assert client.post(f"/api/trainer/days/{TODAY}/entries", json={"data": data}).status_code == 422


def test_days_far_in_the_past_or_future_are_refused() -> None:
    client, _ = signed_in()

    assert client.get(f"/api/trainer/days/{TODAY + timedelta(days=3)}").status_code == 422
    assert client.get("/api/trainer/days/2000-01-01").status_code == 422


def test_progress_has_one_summary_for_every_day() -> None:
    client, _ = signed_in()
    yesterday = TODAY - timedelta(days=1)
    client.post(
        f"/api/trainer/days/{yesterday}/entries", json={"data": {"kind": "weight", "kg": 80}}
    )
    client.post(f"/api/trainer/days/{TODAY}/entries", json={"data": {"kind": "weight", "kg": 79.5}})

    days = client.get(f"/api/trainer/progress?until={TODAY}&days=7").json()["days"]

    assert len(days) == 7
    assert [d["day"] for d in days][-2:] == [yesterday.isoformat(), TODAY.isoformat()]
    assert [d["weight_kg"] for d in days] == [None] * 5 + [80.0, 79.5]


def test_foods_are_estimated_by_the_ai() -> None:
    client, coach = signed_in()
    coach.food_items = [
        FoodGuess(
            food="Masala dosa",
            grams=170,
            calories_100g=165,
            protein_100g=3.5,
            carbs_100g=26,
            fat_100g=5.5,
            portions=[Portion(label="1 dosa", grams=170)],
        )
    ]

    found = client.post("/api/trainer/foods", json={"text": "one masala dosa"}).json()

    assert found["items"][0]["grams"] == 170
    assert found["items"][0]["calories_100g"] == 165
    assert found["items"][0]["portions"] == [{"label": "1 dosa", "grams": 170}]
    assert coach.asked[-1] == ("foods", "one masala dosa", None)


def test_the_coach_knows_today_and_logs_what_you_tell_it() -> None:
    client, coach = signed_in()
    client.put("/api/trainer/profile", json=PROFILE)
    client.post("/api/trainer/plans/workout", json={})
    coach.answer = ""
    coach.logs = (
        {"kind": "water", "ml": 500},
        {
            "kind": "meal",
            "meal": "Lunch",
            "food": "2 chapati",
            "calories": 240,
            "protein_g": 8,
            "carbs_g": 44,
            "fat_g": 4,
        },
        {"kind": "weight", "kg": 3},
    )

    reply = client.post(
        "/api/trainer/coach",
        json={
            "messages": [{"role": "user", "text": "I drank 500 ml and had 2 chapati"}],
            "day": TODAY.isoformat(),
        },
    ).json()

    assert reply["answer"] == "Logged: 500 ml water, 2 chapati (240 kcal)."
    assert [entry["data"]["kind"] for entry in reply["logged"]] == ["water", "meal"]
    assert len(client.get(f"/api/trainer/days/{TODAY}").json()["entries"]) == 2
    _, context, said, _ = coach.asked[-1]
    assert said == ["I drank 500 ml and had 2 chapati"]
    assert f"Today is {WEEKDAYS[TODAY.weekday()]}" in context
    assert '"goal":"lose_fat"' in context
    assert "not instructions" in context


def test_ai_help_counts_against_a_persons_daily_limit() -> None:
    client, coach = signed_in(here=False)
    client.app.state.settings.user_requests_per_day = 2
    coach.food_items = []

    statuses = [
        client.post("/api/trainer/foods", json={"text": "tea"}).status_code for _ in range(3)
    ]

    assert statuses == [200, 200, 429]


def test_everything_can_be_downloaded_and_deleted() -> None:
    client, _ = signed_in()
    client.put("/api/trainer/profile", json=PROFILE)
    client.post(
        f"/api/trainer/days/{TODAY}/entries", json={"data": {"kind": "steps", "count": 5000}}
    )

    exported = client.get("/api/trainer/export").json()
    deleted = client.delete("/api/trainer")

    assert exported["profile"]["name"] == "Ravi"
    assert exported["entries"][0]["data"] == {"kind": "steps", "count": 5000}
    assert deleted.status_code == 204
    assert client.get("/api/trainer").json()["profile"] is None
    assert client.get(f"/api/trainer/days/{TODAY}").json()["entries"] == []


def test_deleting_the_account_deletes_the_trainer_data() -> None:
    client, _ = signed_in()
    client.put("/api/trainer/profile", json=PROFILE)
    client.post(f"/api/trainer/days/{TODAY}/entries", json={"data": {"kind": "water", "ml": 300}})
    user_id = client.get("/api/account").json()["id"]

    client.post("/api/account/delete", json={"password": PASSWORD})

    store = client.app.state.trainer_store
    assert store.profile(user_id) is None
    assert store.everything(user_id) == []


def test_people_never_see_each_others_data() -> None:
    one, _ = signed_in("one@example.com")
    two, _ = signed_in("two@example.com")
    one.put("/api/trainer/profile", json=PROFILE)
    one.post(f"/api/trainer/days/{TODAY}/entries", json={"data": {"kind": "water", "ml": 300}})

    assert two.get("/api/trainer").json()["profile"] is None
    assert two.get(f"/api/trainer/days/{TODAY}").json()["entries"] == []


def test_the_day_is_kept_as_given() -> None:
    client, _ = signed_in()
    yesterday: date = TODAY - timedelta(days=1)

    client.post(
        f"/api/trainer/days/{yesterday}/entries", json={"data": {"kind": "sleep", "hours": 8}}
    )

    assert client.get(f"/api/trainer/days/{yesterday}").json()["summary"]["sleep_hours"] == 8
    assert client.get(f"/api/trainer/days/{TODAY}").json()["summary"]["sleep_hours"] is None


def test_a_food_budget_and_own_prices_are_kept_with_the_profile() -> None:
    client, _ = signed_in()
    prices = [
        {"food": "Rice", "price": 60, "per": "1 kg"},
        {"food": "Eggs", "price": 7, "per": "1"},
    ]

    saved = client.put(
        "/api/trainer/profile",
        json={**PROFILE, "currency": "₹", "food_budget_per_day": 150, "prices": prices},
    )
    plain = client.put("/api/trainer/profile", json=PROFILE).json()["profile"]

    assert saved.status_code == 200
    assert saved.json()["profile"]["prices"] == prices
    assert saved.json()["profile"]["food_budget_per_day"] == 150
    assert (plain["currency"], plain["food_budget_per_day"], plain["prices"]) == ("₹", None, [])


@pytest.mark.parametrize(
    "change",
    [
        {"food_budget_per_day": 0},
        {"prices": [{"food": "", "price": 10, "per": "1 kg"}]},
        {"prices": [{"food": "Rice", "price": -1, "per": "1 kg"}]},
    ],
)
def test_a_budget_or_price_must_make_sense(change: dict) -> None:
    client, _ = signed_in()

    assert client.put("/api/trainer/profile", json={**PROFILE, **change}).status_code == 422


def test_the_history_gives_the_last_sets_of_each_exercise() -> None:
    client, _ = signed_in()
    earlier = TODAY - timedelta(days=3)
    for day, weight in ((earlier, 20), (TODAY, 22.5)):
        client.post(
            f"/api/trainer/days/{day}/entries",
            json={
                "data": {
                    "kind": "exercise",
                    "name": "Goblet squat",
                    "sets": 3,
                    "reps": 10,
                    "weight_kg": weight,
                }
            },
        )
    client.post(
        f"/api/trainer/days/{earlier}/entries",
        json={"data": {"kind": "exercise", "name": "Plank", "sets": 2, "reps": 0}},
    )

    history = client.get("/api/trainer/history").json()["exercises"]

    assert [(item["name"], item["day"], item["weight_kg"]) for item in history] == [
        ("Goblet squat", TODAY.isoformat(), 22.5),
        ("Plank", earlier.isoformat(), None),
    ]
