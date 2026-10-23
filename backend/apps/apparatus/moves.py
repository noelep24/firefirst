"""Moving rigs between stations, permanently or for a while."""

from django.db import transaction
from django.utils import timezone

from .models import ApparatusMove


@transaction.atomic
def move_apparatus(apparatus, *, station, user, temporary, until=None, crew_moves=False, covering_for=None, reason=""):
    """Move ``apparatus`` to ``station``. Returns the ApparatusMove for a temporary move, else None.

    A permanent move changes the rig's home station; its riders either move with it (their assignment
    changes station) or stay put and lose the rig. A temporary move leaves the home station alone: the rig
    counts as being at ``station`` until ``until`` (or until it's returned), and if it covers for another
    rig, that rig's crew rides it meanwhile.
    """
    from apps.scheduling.models import Assignment

    today = timezone.localdate()
    return_apparatus(apparatus, missing_ok=True)

    if not temporary:
        for assignment in Assignment.objects.filter(apparatus=apparatus):
            if crew_moves:
                assignment.station = station
            else:
                assignment.apparatus = None
            assignment.save()
        apparatus.station = station
        apparatus.save(update_fields=["station", "updated_at"])
        return None

    return ApparatusMove.objects.create(
        department=apparatus.department,
        apparatus=apparatus,
        station=station,
        starts_on=today,
        ends_on=until,
        covering_for=covering_for,
        crew_moves=crew_moves,
        reason=reason,
        moved_by=user,
    )


def return_apparatus(apparatus, missing_ok=False):
    """End the rig's temporary move now. Returns the move, or None if it wasn't away."""
    move = ApparatusMove.active_on(apparatus.department, timezone.localdate()).get(apparatus.id)
    if move is None:
        if missing_ok:
            return None
        raise LookupError(f"{apparatus} isn't on a temporary move.")
    move.returned_at = timezone.now()
    move.save(update_fields=["returned_at", "updated_at"])
    return move
