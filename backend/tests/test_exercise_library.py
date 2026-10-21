import pytest

from app.services.trainer import library as library_module
from app.services.trainer.library import (
    FRESH_SECONDS,
    RETRY_SECONDS,
    LibraryUnavailable,
    likeness,
    words,
)
from tests.fakes import IMAGES_URL, LIBRARY, LibraryServer, fake_library, library_entry

pytestmark = pytest.mark.anyio


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> Clock:
    ticking = Clock()
    monkeypatch.setattr(library_module.time, "monotonic", ticking)
    return ticking


async def test_the_library_is_loaded_live_and_tidied() -> None:
    server = LibraryServer()
    library = fake_library(server)

    items = await library.exercises()
    plank = await library.get("Plank")

    assert len(items) == 8
    assert plank is not None
    assert plank.equipment == "body only"
    assert plank.images == [f"{IMAGES_URL}Plank/0.jpg", f"{IMAGES_URL}Plank/1.jpg"]
    assert plank.instructions == ["Stand tall.", "Move with control."]
    assert await library.get("Nothing") is None


async def test_image_paths_are_made_safe_for_addresses() -> None:
    server = LibraryServer(
        [
            {
                "id": "Childs_Pose",
                "name": "Child's Pose",
                "images": ["Child's Pose/0.jpg"],
            }
        ]
    )

    (pose,) = await fake_library(server).exercises()

    assert pose.images == [f"{IMAGES_URL}Child%27s%20Pose/0.jpg"]


async def test_it_is_fetched_once_a_day(clock: Clock) -> None:
    server = LibraryServer()
    library = fake_library(server)

    await library.exercises()
    await library.exercises()
    clock.now += FRESH_SECONDS + 1
    await library.exercises()

    assert server.asked == 2


async def test_a_failed_load_is_explained_and_tried_again_later(clock: Clock) -> None:
    server = LibraryServer(status=500)
    library = fake_library(server)

    with pytest.raises(LibraryUnavailable, match="internet connection"):
        await library.exercises()
    with pytest.raises(LibraryUnavailable):
        await library.exercises()
    server.status = 200
    clock.now += RETRY_SECONDS + 1

    assert len(await library.exercises()) == 8
    assert server.asked == 2


async def test_the_last_good_copy_is_kept_when_a_refresh_fails(clock: Clock) -> None:
    server = LibraryServer()
    library = fake_library(server)
    await library.exercises()
    server.status = 503
    clock.now += FRESH_SECONDS + 1

    assert len(await library.exercises()) == 8


async def test_a_library_that_is_not_a_list_is_refused() -> None:
    server = LibraryServer(entries={"exercises": []})

    with pytest.raises(LibraryUnavailable):
        await fake_library(server).exercises()


def test_names_are_compared_by_their_words() -> None:
    assert words("Push-Ups") == words("pushup")
    assert words("Seated Cable Rows") == {"seated", "cable", "row"}
    assert words("Bench Press") == {"bench", "press"}
    assert likeness(words("cable row"), words("Seated Cable Rows")) == pytest.approx(2 / 3)
    assert likeness(frozenset(), words("Plank")) == 0


@pytest.mark.parametrize(
    ("name", "equipment", "found"),
    [
        ("Goblet squats", "gym", "Goblet_Squat"),
        ("Push-up", "gym", "Pushups"),
        ("Cable row", "gym", "Seated_Cable_Rows"),
        ("Shoulder press", "home_dumbbells", "Dumbbell_Shoulder_Press"),
        ("Shoulder press", "gym", "Barbell_Shoulder_Press"),
        ("Leg press", "bodyweight", "Leg_Press"),
        ("Zumba", "gym", None),
        ("!!!", None, None),
    ],
)
async def test_plan_names_are_matched_to_the_library(
    name: str, equipment: str | None, found: str | None
) -> None:
    match = await fake_library().match(name, equipment)

    assert (match.id if match else None) == found


async def test_plans_are_offered_only_what_the_person_can_use() -> None:
    library = fake_library()

    bodyweight = {item.id for item in await library.choices("bodyweight")}
    gym = {item.id for item in await library.choices("gym")}

    assert bodyweight == {"Pushups", "Plank"}
    assert "Atlas_Stones" not in gym and "Leg_Press" in gym


async def test_plans_are_offered_exercises_that_suit_the_persons_level() -> None:
    server = LibraryServer(
        entries=[
            *LIBRARY,
            library_entry(
                "Barbell_Squat", "Barbell Squat", "barbell", "quadriceps", "intermediate"
            ),
            library_entry("Muscle_Up", "Muscle Up", "body only", "lats", "expert"),
            library_entry("Power_Snatch", "Power Snatch", "barbell", "hamstrings", "intermediate")
            | {"category": "olympic weightlifting"},
        ]
    )
    library = fake_library(server)

    beginner = {item.id for item in await library.choices("gym", "beginner")}
    advanced = {item.id for item in await library.choices("gym", "advanced")}

    assert {"Goblet_Squat", "Barbell_Squat"} <= beginner
    assert not {"Muscle_Up", "Power_Snatch", "Atlas_Stones"} & beginner
    assert {"Muscle_Up", "Power_Snatch"} <= advanced and "Atlas_Stones" not in advanced
