from app.models.trainer import Profile, Targets

ACTIVITY = {"sitting": 1.2, "light": 1.375, "moderate": 1.55, "very_active": 1.725}
GOAL_CHANGE = {
    "lose_fat": -0.2,
    "build_muscle": 0.1,
    "get_fit": 0.0,
    "get_stronger": 0.05,
    "endurance": 0.05,
}
PROTEIN_PER_KG = {
    "lose_fat": 2.0,
    "build_muscle": 1.8,
    "get_fit": 1.6,
    "get_stronger": 1.8,
    "endurance": 1.4,
}
FAT_SHARE = 0.25
WATER_PER_KG = 35
GROWN_UP = 18
GOAL_WORDS = {
    "lose_fat": "20% below what you burn, to lose fat steadily",
    "build_muscle": "10% above what you burn, to build muscle",
    "get_fit": "about what you burn, to stay level",
    "get_stronger": "5% above what you burn, to get stronger",
    "endurance": "5% above what you burn, for endurance training",
}


def _round(value: float, step: int) -> int:
    return int(round(value / step) * step)


def targets_for(profile: Profile) -> Targets:
    shift = 5 if profile.sex == "male" else -161
    resting = 10 * profile.weight_kg + 6.25 * profile.height_cm - 5 * profile.age + shift
    burn = resting * ACTIVITY[profile.activity]
    change = GOAL_CHANGE[profile.goal]
    if profile.age < GROWN_UP:
        change = max(change, 0.0)
    calories = max(burn * (1 + change), resting)
    protein = PROTEIN_PER_KG[profile.goal] * profile.weight_kg
    fat = calories * FAT_SHARE / 9
    carbs = max(0.0, (calories - protein * 4 - fat * 9) / 4)
    goal = (
        GOAL_WORDS[profile.goal] if change == GOAL_CHANGE[profile.goal] else GOAL_WORDS["get_fit"]
    )
    explanation = (
        f"Your body uses about {_round(resting, 10)} kcal a day at rest (Mifflin-St Jeor"
        f" formula) and about {_round(burn, 10)} kcal with your activity. The target is {goal}."
        f" Protein is {PROTEIN_PER_KG[profile.goal]:g} g per kg of body weight, fat a quarter of"
        " the calories, and carbohydrates the rest."
    )
    if profile.age < GROWN_UP:
        explanation += (
            " Under 18 the target never goes below what you burn: a growing body needs it."
        )
    return Targets(
        calories=_round(calories, 10),
        protein_g=_round(protein, 5),
        carbs_g=_round(carbs, 5),
        fat_g=_round(fat, 5),
        water_ml=_round(WATER_PER_KG * profile.weight_kg, 250),
        resting_calories=_round(resting, 10),
        daily_burn=_round(burn, 10),
        explanation=explanation,
    )
