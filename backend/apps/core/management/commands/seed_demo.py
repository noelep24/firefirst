"""Create a demo department with realistic sample data.

    python manage.py seed_demo

Every demo login uses the password ``firefirst-demo``.
"""

import base64
import datetime
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.apparatus.models import Apparatus, ChecklistItem, ChecklistTemplate, MaintenanceSchedule
from apps.certifications.models import Certification, CertificationType
from apps.core.models import Department, Station, User
from apps.events.models import Event
from apps.inventory.models import Item, StockLevel, StorageLocation
from apps.scheduling.models import Assignment, OvertimeShift, Platoon, RotationPattern, StaffingRule

PASSWORD = "firefirst-demo"

ENGINE_CHECK = {
    "Cab": ["Fuel 3/4 or more", "Radios and MDT working", "Mirrors and windows"],
    "Exterior": ["Lights, emergency lights and siren", "Tires and lug nuts", "No fluid leaks"],
    "Pump": ["Engage pump, check pressure", "Tank full", "Primer operates"],
    "Equipment": ["SCBA bottles 4,500 psi or more", "TIC charged", "Gas meter bump-tested"],
}

ITEMS = [
    ("4x4 gauze", "medical", "pack", 40, 30),
    ("Nitrile gloves L", "medical", "box", 12, 10),
    ("Normal saline 1000 mL", "medical", "bag", 18, 20),
    ("Epinephrine 1 mg/mL", "medical", "vial", 6, 6),
    ("Class A foam", "equipment", "pail", 4, 3),
    ("2.5 in. hose, 50 ft", "equipment", "length", 6, 6),
    ("Structure gloves", "fire_gear", "pair", 5, 8),
    ("Turnout hood", "fire_gear", "each", 10, 8),
    ("Station T-shirt, L", "uniforms", "each", 12, 10),
    ("Uniform pants, 34", "uniforms", "pair", 3, 4),
    ("Paper towels", "other", "case", 2, 2),
]


# Shift / station / position order: A1 captain, engineer, firefighter, paramedic, then A2, B1, ...
CREW_NAMES = [
    ("Alex", "Smith"),
    ("Maria", "Lopez"),
    ("Derek", "Nguyen"),
    ("Tasha", "Brooks"),
    ("Ray", "Okafor"),
    ("Jen", "Walsh"),
    ("Luis", "Ortega"),
    ("Kim", "Patel"),
    ("Dana", "Fischer"),
    ("Marcus", "Hill"),
    ("Erin", "Kowalski"),
    ("Sam", "Reyes"),
    ("Tom", "Bradley"),
    ("Priya", "Shah"),
    ("Cole", "Jensen"),
    ("Nina", "Castillo"),
    ("Grant", "Murphy"),
    ("Leah", "Owens"),
    ("Victor", "Diaz"),
    ("Amy", "Chen"),
    ("Hank", "Roberts"),
    ("Sofia", "Morales"),
    ("Ben", "Carter"),
    ("Jade", "Kim"),
]


class Command(BaseCommand):
    help = "Create a demo department with sample stations, members, apparatus, inventory and events."

    def add_arguments(self, parser):
        parser.add_argument("--slug", default="demo")

    @transaction.atomic
    def handle(self, *args, slug, **options):
        if Department.objects.filter(slug=slug).exists():
            raise CommandError(f"Department '{slug}' already exists.")
        today = timezone.localdate()
        # A placeholder NERIS ID, so demo incident reports can be completed.
        patch = base64.b64encode((Path(__file__).parent / "demo_patch.png").read_bytes()).decode()
        dept = Department.objects.create(
            name="Demo Fire Rescue", slug=slug, neris_id="FD00000000", logo=f"data:image/png;base64,{patch}"
        )
        st1 = Station.objects.create(department=dept, number="1", name="Headquarters", address="100 Main St")
        st2 = Station.objects.create(department=dept, number="2", name="Northside", address="2200 N Oak Ave")

        platoons = {
            c: Platoon.objects.create(department=dept, code=c, color=color)
            for c, color in (("A", "#c62828"), ("B", "#1565c0"), ("C", "#2e7d32"))
        }
        RotationPattern.objects.create(department=dept, name="24/48", anchor_date=today, sequence=["A", "B", "C"])

        def user(username, first, last, role=User.Role.MEMBER, rank="Firefighter", **kw):
            return User.objects.create_user(
                username=f"{slug}-{username}",
                password=PASSWORD,
                department=dept,
                role=role,
                first_name=first,
                last_name=last,
                rank=rank,
                # example.com never delivers, so trial emails (printed in the terminal) can't reach anyone.
                email=f"{username}@example.com",
                **kw,
            )

        user("chief", "Jordan", "Hale", User.Role.ADMIN, "Chief")
        crew = 0
        for code in "ABC":
            for station in (st1, st2):
                for position, rank, role in (
                    (Assignment.Position.CAPTAIN, "Captain", User.Role.OFFICER),
                    (Assignment.Position.ENGINEER, "Engineer", User.Role.MEMBER),
                    (Assignment.Position.FIREFIGHTER, "Firefighter", User.Role.MEMBER),
                    (Assignment.Position.PARAMEDIC, "FF/Paramedic", User.Role.MEMBER),
                ):
                    first, last = CREW_NAMES[crew]
                    crew += 1
                    u = user(
                        f"{code.lower()}{station.number}-{position}",
                        first,
                        last,
                        role,
                        rank,
                        home_station=station,
                    )
                    Assignment.objects.create(
                        department=dept, user=u, platoon=platoons[code], station=station, position=position
                    )

        self.seed_certifications(dept, today, st1, st2)

        # Some overtime history, so the mandatory overtime lists have an order.
        for days_ago, username in (
            (40, "b1-engineer"),
            (33, "c2-captain"),
            (26, "b2-paramedic"),
            (19, "c1-firefighter"),
            (12, "b1-captain"),
            (5, "c2-firefighter"),
        ):
            OvertimeShift.objects.create(
                department=dept,
                user=User.objects.get(username=f"{slug}-{username}"),
                date=today - datetime.timedelta(days=days_ago),
                hours=24,
            )

        e1 = Apparatus.objects.create(
            department=dept,
            unit_number="E1",
            apparatus_type="engine",
            station=st1,
            make="Pierce",
            model="Enforcer",
            year=2019,
            mileage=41_250,
            engine_hours=3_120,
        )
        Apparatus.objects.create(
            department=dept,
            unit_number="L1",
            apparatus_type="ladder",
            station=st1,
            make="E-ONE",
            model="HP 100",
            year=2015,
            mileage=58_900,
            engine_hours=4_870,
        )
        m1 = Apparatus.objects.create(
            department=dept,
            unit_number="M1",
            apparatus_type="ambulance",
            station=st1,
            make="Horton",
            model="Type I",
            year=2022,
            mileage=36_400,
        )
        e2 = Apparatus.objects.create(
            department=dept,
            unit_number="E2",
            apparatus_type="engine",
            station=st2,
            make="Spartan",
            model="Gladiator",
            year=2012,
            mileage=88_100,
            engine_hours=7_400,
        )

        Apparatus.objects.create(
            department=dept,
            unit_number="E3",
            apparatus_type="engine",
            station=st2,
            status="reserve",
            make="Pierce",
            model="Arrow XT",
            year=2006,
            mileage=121_300,
            engine_hours=9_850,
            notes="Reserve engine. Move it to cover for a frontline engine in the shop.",
        )

        # Riding assignments: Station 1 staffs E1 and M1 (L1 is cross-staffed), Station 2 staffs E2.
        for assignment in Assignment.objects.filter(department=dept).select_related("station"):
            if assignment.station == st2:
                assignment.apparatus = e2
            elif assignment.position == Assignment.Position.PARAMEDIC:
                assignment.apparatus = m1
            else:
                assignment.apparatus = e1
            assignment.save(update_fields=["apparatus"])

        template = ChecklistTemplate.objects.create(department=dept, name="Engine daily check", apparatus_type="engine")
        order = 0
        for section, prompts in ENGINE_CHECK.items():
            for prompt in prompts:
                ChecklistItem.objects.create(template=template, section=section, prompt=prompt, order=order)
                order += 1

        for rig in (e1, e2):
            MaintenanceSchedule.objects.create(
                department=dept,
                apparatus=rig,
                task="Annual pump service test (NFPA 1911)",
                interval_days=365,
                last_performed_on=today - datetime.timedelta(days=355),
            )
            MaintenanceSchedule.objects.create(
                department=dept,
                apparatus=rig,
                task="Oil and filter",
                interval_miles=5_000,
                interval_days=180,
                last_performed_on=today - datetime.timedelta(days=60),
                last_mileage=rig.mileage - 1_200,
            )

        supply = StorageLocation.objects.create(department=dept, name="EMS supply room", station=st1)
        m1_cabinet = StorageLocation.objects.create(department=dept, name="Main cabinet", apparatus=m1)
        for name, category, unit, qty, par in ITEMS:
            item = Item.objects.create(
                department=dept, name=name, category=category, unit=unit, tracks_expiration=category == "medical"
            )
            expires = today + datetime.timedelta(days=21) if name.startswith("Epinephrine") else None
            StockLevel.objects.create(
                department=dept, item=item, location=supply, quantity=qty, par_level=par, expires_on=expires
            )
            if category == "medical":
                StockLevel.objects.create(
                    department=dept,
                    item=item,
                    location=m1_cabinet,
                    quantity=par // 4,
                    par_level=par // 4 or 1,
                    expires_on=expires,
                )

        start = timezone.now().replace(hour=14, minute=0, second=0, microsecond=0)
        Event.objects.create(
            department=dept,
            title="Live-fire training",
            category="training",
            station=st1,
            starts_at=start + datetime.timedelta(days=3),
            ends_at=start + datetime.timedelta(days=3, hours=4),
            training_hours=4,
            is_mandatory=True,
        )
        Event.objects.create(
            department=dept,
            title="Monthly officers' meeting",
            category="meeting",
            starts_at=start + datetime.timedelta(days=6),
            ends_at=start + datetime.timedelta(days=6, hours=1),
        )
        Event.objects.create(
            department=dept,
            title="Fire Prevention Week open house",
            category="public_ed",
            station=st2,
            starts_at=start + datetime.timedelta(days=10),
            ends_at=start + datetime.timedelta(days=10, hours=3),
        )

        self.stdout.write(
            self.style.SUCCESS(f"Created '{dept}' with {crew + 1} members. Log in as {slug}-chief / {PASSWORD}")
        )

    def seed_certifications(self, dept, today, st1, st2):
        emt = CertificationType.objects.create(
            department=dept, name="EMT", code="EMT-B", renewal_months=24, required_for_all=True
        )
        medic = CertificationType.objects.create(department=dept, name="Paramedic", code="NRP", renewal_months=24)
        driver = CertificationType.objects.create(
            department=dept, name="Driver/Operator", code="D/O", renewal_months=36
        )
        cpr = CertificationType.objects.create(
            department=dept, name="CPR / BLS", renewal_months=24, required_for_all=True
        )
        for n, assignment in enumerate(Assignment.objects.filter(department=dept).select_related("user")):
            user, position = assignment.user, assignment.position
            # Stagger issue dates so a few cards are due soon, as in a real roster.
            issued = today - datetime.timedelta(days=700 - n * 25)
            Certification.objects.create(department=dept, user=user, certification_type=emt, issued_on=issued)
            if n % 7 != 3:  # a couple of members are behind on CPR
                Certification.objects.create(department=dept, user=user, certification_type=cpr, issued_on=issued)
            if position == Assignment.Position.PARAMEDIC:
                Certification.objects.create(department=dept, user=user, certification_type=medic, issued_on=issued)
            if position in (Assignment.Position.ENGINEER, Assignment.Position.CAPTAIN):
                Certification.objects.create(department=dept, user=user, certification_type=driver, issued_on=issued)
        StaffingRule.objects.create(department=dept, station=st1, minimum=4)
        StaffingRule.objects.create(department=dept, station=st1, certification_type=medic, minimum=1)
        StaffingRule.objects.create(department=dept, station=st2, minimum=3)
        StaffingRule.objects.create(department=dept, certification_type=driver, minimum=2)
