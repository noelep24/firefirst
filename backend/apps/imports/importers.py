import re
import unicodedata

from apps.apparatus.models import Apparatus
from apps.core.models import Station, User
from apps.inventory.models import Item, StockLevel, StockTransaction, StorageLocation
from apps.scheduling.models import Assignment, Platoon

from .engine import Column, Importer, RowResult, match_choice, parse_date, parse_decimal, parse_int

PLATOON_COLORS = ["#c62828", "#1565c0", "#2e7d32", "#6a1b9a", "#ef6c00", "#00838f"]


def station_number(value):
    """ "Station 7", "Sta. 7", "#7", "7" -> "7" """
    text = re.sub(r"^(fire\s+)?(station|sta\.?|stn\.?|st\.?|house)\s*", "", value.strip(), flags=re.I)
    return text.lstrip("#").strip()


class StationLookup:
    """Find stations by number, planning to create missing ones."""

    def __init__(self, department):
        self.department = department
        self.by_number = {s.number.lower(): s for s in Station.objects.filter(department=department)}
        self.planned = set()

    def check(self, value, result):
        number = station_number(value)
        if not number:
            return None
        if number.lower() not in self.by_number and number.lower() not in self.planned:
            self.planned.add(number.lower())
            result.notes.append(f"Creates Station {number}")
        return number

    def get(self, number):
        if number is None:
            return None
        station = self.by_number.get(number.lower())
        if station is None:
            station = Station.objects.create(department=self.department, number=number)
            self.by_number[number.lower()] = station
        return station


# ---------------------------------------------------------------- People

ROLE_CHOICES = list(User.Role.choices)
POSITION_KEYWORDS = [
    (("chief", "battalion", "bc", "division"), Assignment.Position.CHIEF),
    (("captain", "capt", "cpt"), Assignment.Position.CAPTAIN),
    (("lieutenant", "lt", "lieut"), Assignment.Position.LIEUTENANT),
    (("engineer", "driver", "operator", "do", "eng", "chauffeur", "mpo"), Assignment.Position.ENGINEER),
    (("paramedic", "medic", "pm", "fp", "ff p", "firefighter paramedic"), Assignment.Position.PARAMEDIC),
    (("emt", "emt b", "emt a", "aemt"), Assignment.Position.EMT),
    (("firefighter", "ff", "fire fighter", "probationary", "probie", "recruit"), Assignment.Position.FIREFIGHTER),
]


def ascii_slug(text):
    return re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower())


class PeopleImporter(Importer):
    kind = "people"
    title = "People"
    description = (
        "Members, with optional station, platoon and riding position. Existing people are matched by employee ID, "
        "then username, then email, and updated. Imported people can't sign in until an admin sets a password. "
        "App role defaults to Member: rank never grants officer access."
    )
    columns = [
        Column("first_name", "First name", ("first", "given name", "fname")),
        Column("last_name", "Last name", ("last", "surname", "family name", "lname")),
        Column(
            "full_name",
            "Name",
            ("full name", "member", "member name", "employee name", "personnel"),
            help="“Last, First” or “First Last”, if there are no separate name columns",
        ),
        Column("username", "Username", ("login", "user name", "user id", "userid")),
        Column("email", "Email", ("e mail", "email address")),
        Column("phone", "Phone", ("mobile", "cell", "cell phone", "phone number", "mobile phone")),
        Column(
            "employee_id",
            "Employee ID",
            (
                "emp id",
                "employee number",
                "employee no",
                "badge",
                "badge number",
                "personnel id",
                "payroll id",
                "id number",
            ),
        ),
        Column("rank", "Rank", ("title", "job title")),
        Column(
            "role",
            "App role",
            ("role", "access", "permission", "access level"),
            help="member, officer or admin. Defaults to member",
        ),
        Column("station", "Station", ("home station", "assigned station", "station number", "sta")),
        Column("platoon", "Platoon", ("shift", "platoon shift", "crew"), help="Platoon code such as A, B or C"),
        Column("position", "Position", ("riding position", "seat", "assignment", "position title")),
    ]
    example = [
        "Alex",
        "Rivera",
        "",
        "",
        "arivera@city.gov",
        "555-0101",
        "1042",
        "Firefighter",
        "member",
        "1",
        "A",
        "Firefighter",
    ]

    def template_rows(self):
        return [[c.label for c in self.columns], self.example]

    def prepare(self):
        people = list(User.objects.filter(department=self.department))
        self.by_employee_id = {u.employee_id.lower(): u for u in people if u.employee_id}
        self.by_username = {u.username.lower(): u for u in User.objects.all().only("id", "username", "department_id")}
        self.by_email = {u.email.lower(): u for u in people if u.email}
        self.stations = StationLookup(self.department)
        self.platoons = {p.code.lower(): p for p in Platoon.objects.filter(department=self.department)}
        self.planned_platoons = set()
        self.seen = {}
        self.taken_usernames = set(self.by_username)

    def _split_name(self, full):
        if "," in full:
            last, first = [p.strip() for p in full.split(",", 1)]
        else:
            parts = full.split()
            first, last = (" ".join(parts[:-1]), parts[-1]) if len(parts) > 1 else (full, "")
        return first, last

    def _username_for(self, first, last):
        base = f"{self.department.slug}-{ascii_slug(first[:1])}{ascii_slug(last)}" or f"{self.department.slug}-member"
        candidate, n = base, 2
        while candidate.lower() in self.taken_usernames:
            candidate, n = f"{base}{n}", n + 1
        return candidate

    def check(self, values, result: RowResult):
        first, last = values.get("first_name", ""), values.get("last_name", "")
        if not (first or last) and values.get("full_name"):
            first, last = self._split_name(values["full_name"])

        employee_id = values.get("employee_id", "")
        username = values.get("username", "")
        email = values.get("email", "")
        existing = (
            (employee_id and self.by_employee_id.get(employee_id.lower()))
            or (username and self.by_username.get(username.lower()))
            or (email and self.by_email.get(email.lower()))
            or None
        )
        if existing is None and not (first or last or username):
            result.error("Needs a name or username.")
            return
        result.label = f"{first} {last}".strip() or username or (str(existing) if existing else "")
        if existing is not None and existing.department_id != self.department.id:
            result.error(f"Username “{username}” is already taken by another department.")
            return
        key = employee_id.lower() or username.lower() or email.lower() or result.label.lower()
        if key in self.seen:
            result.error(f"Same person as row {self.seen[key]}.")
            return
        self.seen[key] = result.line

        role = "member"
        if values.get("role"):
            role = match_choice(values["role"], ROLE_CHOICES, name="App role")
        position = None
        if values.get("position"):
            position = match_choice(
                values["position"], list(Assignment.Position.choices), POSITION_KEYWORDS, "Position"
            )

        platoon_code = values.get("platoon", "").strip()
        platoon_code = re.sub(r"^(shift|platoon)\s+", "", platoon_code, flags=re.I)
        platoon_code = re.sub(r"\s+(shift|platoon)$", "", platoon_code, flags=re.I).upper()
        if (
            platoon_code
            and platoon_code.lower() not in self.platoons
            and platoon_code.lower() not in self.planned_platoons
        ):
            self.planned_platoons.add(platoon_code.lower())
            result.notes.append(f"Creates platoon {platoon_code}")
        if position and not platoon_code:
            result.notes.append("Position ignored: no platoon given")

        station = self.stations.check(values["station"], result) if values.get("station") else None

        if existing is None:
            username = username or self._username_for(first, last)
            if username.lower() in self.taken_usernames:
                result.error(f"Username “{username}” is already taken.")
                return
            self.taken_usernames.add(username.lower())
        result.action = "update" if existing else "create"
        result.data = {
            "user": existing,
            "fields": {
                k: v
                for k, v in {
                    "first_name": first,
                    "last_name": last,
                    "email": email,
                    "phone": values.get("phone", ""),
                    "employee_id": employee_id,
                    "rank": values.get("rank", ""),
                }.items()
                if v or existing is None
            },
            "username": username,
            "role": role if (values.get("role") or existing is None) else None,
            "station": station,
            "platoon": platoon_code or None,
            "position": position,
        }

    def _platoon(self, code):
        platoon = self.platoons.get(code.lower())
        if platoon is None:
            color = PLATOON_COLORS[len(self.platoons) % len(PLATOON_COLORS)]
            platoon = Platoon.objects.create(department=self.department, code=code, name=f"{code} Shift", color=color)
            self.platoons[code.lower()] = platoon
        return platoon

    def apply(self, result):
        d = result.data
        user = d["user"]
        if user is None:
            user = User(department=self.department, username=d["username"], role=d["role"])
            user.set_unusable_password()
        elif d["role"]:
            user.role = d["role"]
        for name, value in d["fields"].items():
            setattr(user, name, value)
        station = self.stations.get(d["station"])
        if station:
            user.home_station = station
        user.save()
        if d["platoon"]:
            Assignment.objects.update_or_create(
                user=user,
                defaults={
                    "department": self.department,
                    "platoon": self._platoon(d["platoon"]),
                    **({"station": station} if station else {}),
                    **({"position": d["position"]} if d["position"] else {}),
                },
            )


# ---------------------------------------------------------------- Apparatus

APPARATUS_KEYWORDS = [
    # Specific kinds first: "Brush Truck" is a brush unit, "Water Tender" a tender.
    (("quint",), Apparatus.Type.QUINT),
    (("brush", "wildland", "type 3", "type 6", "grass"), Apparatus.Type.BRUSH),
    (("tender", "tanker", "water tender"), Apparatus.Type.TENDER),
    (("hazmat", "haz mat", "hazardous"), Apparatus.Type.HAZMAT),
    (("ambulance", "medic", "ems", "als", "bls", "rescue ambulance", "mica"), Apparatus.Type.AMBULANCE),
    (("ladder", "aerial", "tower", "platform", "tiller"), Apparatus.Type.LADDER),
    (("rescue", "squad", "heavy rescue", "technical rescue"), Apparatus.Type.RESCUE),
    (("engine", "pumper", "pump", "wagon", "type 1"), Apparatus.Type.ENGINE),
    (("chief", "command", "battalion", "staff", "car", "suv"), Apparatus.Type.COMMAND),
    (("utility", "support", "service", "pickup", "air", "rehab", "trailer"), Apparatus.Type.UTILITY),
    # In the fire service a bare "truck" means a ladder truck.
    (("truck",), Apparatus.Type.LADDER),
]
STATUS_KEYWORDS = [
    (("limited",), Apparatus.Status.LIMITED),
    (("out of service", "oos", "down", "shop", "repair"), Apparatus.Status.OUT_OF_SERVICE),
    (("reserve", "spare", "backup", "standby"), Apparatus.Status.RESERVE),
    (("in service", "active", "available", "front line", "frontline", "ok", "yes"), Apparatus.Status.IN_SERVICE),
]


class ApparatusImporter(Importer):
    kind = "apparatus"
    title = "Apparatus"
    description = "Your fleet. Existing units are matched by unit number and updated."
    columns = [
        Column(
            "unit_number",
            "Unit number",
            ("unit", "unit #", "unit no", "unit id", "apparatus", "vehicle", "call sign", "radio id", "vehicle id"),
            required=True,
            example="E1",
        ),
        Column(
            "apparatus_type",
            "Type",
            ("apparatus type", "vehicle type", "class", "category"),
            help="Engine, Ladder, Medic, Tanker… (common names are recognized)",
            example="Engine",
        ),
        Column("station", "Station", ("home station", "assigned station", "location", "station number"), example="1"),
        Column("status", "Status", ("service status", "in service"), example="In service"),
        Column("make", "Make", ("manufacturer", "mfr"), example="Pierce"),
        Column("model", "Model", (), example="Enforcer"),
        Column("year", "Year", ("model year", "yr"), example="2019"),
        Column("vin", "VIN", ("vin number", "serial", "serial number"), example="4P1BAAGF0KA012345"),
        Column("license_plate", "License plate", ("plate", "license", "tag", "plate number"), example="FD-1234"),
        Column("mileage", "Mileage", ("miles", "odometer", "current mileage"), example="41250"),
        Column("engine_hours", "Engine hours", ("hours", "hour meter", "engine hrs"), example="3120"),
        Column("notes", "Notes", ("comments", "remarks"), example=""),
    ]

    def prepare(self):
        self.existing = {a.unit_number.lower(): a for a in Apparatus.objects.filter(department=self.department)}
        self.stations = StationLookup(self.department)
        self.seen = {}

    def check(self, values, result: RowResult):
        unit = values.get("unit_number", "").strip()
        if not unit:
            result.error("Unit number is empty.")
            return
        result.label = unit
        if unit.lower() in self.seen:
            result.error(f"Same unit as row {self.seen[unit.lower()]}.")
            return
        self.seen[unit.lower()] = result.line
        existing = self.existing.get(unit.lower())

        fields = {}
        if values.get("apparatus_type"):
            fields["apparatus_type"] = match_choice(
                values["apparatus_type"], list(Apparatus.Type.choices), APPARATUS_KEYWORDS, "Type"
            )
        elif existing is None:
            result.error("Type is required for new apparatus.")
            return
        if values.get("status"):
            fields["status"] = match_choice(values["status"], list(Apparatus.Status.choices), STATUS_KEYWORDS, "Status")
        for name in ("make", "model", "vin", "license_plate", "notes"):
            if values.get(name):
                fields[name] = values[name]
        if values.get("year"):
            year = parse_int(values["year"], "Year")
            if not 1900 <= year <= 2100:
                raise ValueError(f"Year {year} doesn't look right.")
            fields["year"] = year
        if values.get("mileage"):
            fields["mileage"] = parse_int(values["mileage"], "Mileage")
        if values.get("engine_hours"):
            fields["engine_hours"] = parse_decimal(values["engine_hours"], "Engine hours")
        station = self.stations.check(values["station"], result) if values.get("station") else None

        result.action = "update" if existing else "create"
        result.data = {"existing": existing, "unit": unit, "fields": fields, "station": station}

    def apply(self, result):
        d = result.data
        rig = d["existing"] or Apparatus(department=self.department, unit_number=d["unit"])
        for name, value in d["fields"].items():
            setattr(rig, name, value)
        if d["station"]:
            rig.station = self.stations.get(d["station"])
        rig.save()


# ---------------------------------------------------------------- Inventory

CATEGORY_KEYWORDS = [
    (("ems", "medical", "med", "medication", "drug", "airway", "bls", "als", "trauma", "iv"), Item.Category.EMS),
    (("ppe", "turnout", "turnouts", "gear", "bunker", "helmet", "glove", "gloves", "boots", "hood"), Item.Category.PPE),
    (("scba", "air", "mask", "bottle", "cylinder"), Item.Category.SCBA),
    (("hose", "nozzle", "appliance", "fitting", "coupling"), Item.Category.HOSE),
    (("tool", "tools", "equipment", "hand tool", "power tool", "extrication"), Item.Category.TOOLS),
    (("station", "office", "janitorial", "cleaning", "kitchen", "household", "supplies"), Item.Category.STATION),
]


class InventoryImporter(Importer):
    kind = "inventory"
    title = "Inventory"
    description = (
        "Items, and optionally how many are stocked where. Items are matched by SKU, then name. A row with a location "
        "sets the on-hand count there (logged as a count correction) along with par and expiration."
    )
    columns = [
        Column(
            "item",
            "Item",
            ("item name", "name", "product", "description", "item description", "supply"),
            required=True,
            example="Nitrile gloves, large",
        ),
        Column(
            "category",
            "Category",
            ("type", "class", "item category"),
            help="EMS, PPE, SCBA, Tools, Hose, Station…",
            example="EMS",
        ),
        Column("unit", "Unit", ("uom", "unit of measure", "units", "pack size"), example="box"),
        Column(
            "sku",
            "SKU",
            ("part number", "part no", "item number", "catalog number", "item no", "product code"),
            example="NGL-L-100",
        ),
        Column("barcode", "Barcode", ("upc", "gtin", "ean"), example="0123456789012"),
        Column(
            "location",
            "Location",
            ("storage location", "bin", "shelf", "compartment", "storage"),
            example="EMS supply room",
        ),
        Column("station", "Station", ("station number",), example="1"),
        Column(
            "apparatus",
            "Apparatus",
            ("vehicle", "rig", "truck", "unit number"),
            help="For stock kept on a rig",
            example="",
        ),
        Column(
            "quantity",
            "Quantity",
            ("qty", "on hand", "count", "qty on hand", "quantity on hand", "stock"),
            example="12",
        ),
        Column(
            "par_level",
            "Par level",
            ("par", "min", "minimum", "reorder point", "reorder level", "min qty"),
            example="10",
        ),
        Column(
            "expires_on",
            "Expires",
            ("expiration", "expiration date", "exp date", "expiry", "exp", "expires on"),
            example="2027-03-31",
        ),
    ]

    def prepare(self):
        items = list(Item.objects.filter(department=self.department))
        self.items_by_sku = {i.sku.lower(): i for i in items if i.sku}
        self.items_by_name = {i.name.lower(): i for i in items}
        self.planned_items = {}  # item key -> first row that creates it
        self.created_items = {}  # item key -> Item, filled in while applying
        self.stations = StationLookup(self.department)
        self.rigs = {a.unit_number.lower(): a for a in Apparatus.objects.filter(department=self.department)}
        self.locations = list(StorageLocation.objects.filter(department=self.department).select_related("station"))
        self.locations_by_name = {}
        for loc in self.locations:
            self.locations_by_name.setdefault(loc.name.lower(), []).append(loc)
        self.planned_locations = set()
        self.seen_stock = {}

    def check(self, values, result: RowResult):
        name = values.get("item", "").strip()
        if not name:
            result.error("Item name is empty.")
            return
        result.label = name
        sku = values.get("sku", "").strip()
        existing_item = (sku and self.items_by_sku.get(sku.lower())) or self.items_by_name.get(name.lower())
        item_key = (sku or name).lower()
        planned = self.planned_items.get(item_key)

        item_fields = {"name": name}
        if values.get("category"):
            item_fields["category"] = match_choice(
                values["category"], list(Item.Category.choices), CATEGORY_KEYWORDS, "Category"
            )
        for field in ("unit", "sku", "barcode"):
            if values.get(field):
                item_fields[field] = values[field]

        # Where it's stocked (optional).
        location_name = values.get("location", "").strip()
        station = None
        rig = None
        if values.get("apparatus"):
            rig = self.rigs.get(values["apparatus"].strip().lower())
            if rig is None:
                result.error(f"No apparatus “{values['apparatus']}”. Import apparatus first.")
                return
        if values.get("station"):
            station = self.stations.check(values["station"], result)
        has_stock_values = any(values.get(k) for k in ("quantity", "par_level", "expires_on"))
        location = None
        if location_name or station or rig:
            if not location_name:
                location_name = "Main storage" if station else "Main compartment"
            if station and rig:
                result.error("Give a station or an apparatus for the location, not both.")
                return
            if not station and not rig:
                matches = self.locations_by_name.get(location_name.lower(), [])
                if len(matches) != 1:
                    result.error(
                        f"Location “{location_name}” needs a Station or Apparatus column"
                        + (" (several locations have that name)." if matches else ".")
                    )
                    return
                location = ("existing", matches[0])
            else:
                location = ("lookup", location_name, station, rig)
                key = (location_name.lower(), station, rig.id if rig else None)
                if not self._location_exists(location_name, station, rig) and key not in self.planned_locations:
                    self.planned_locations.add(key)
                    where = f"Station {station}" if station else rig.unit_number
                    result.notes.append(f"Creates location “{location_name}” at {where}")
        elif has_stock_values:
            result.error("Quantity, par or expiration needs a Location (with a Station or Apparatus).")
            return

        stock = {}
        if values.get("quantity"):
            stock["quantity"] = parse_int(values["quantity"], "Quantity")
        if values.get("par_level"):
            stock["par_level"] = parse_int(values["par_level"], "Par level")
        if values.get("expires_on"):
            stock["expires_on"] = parse_date(values["expires_on"], "Expires")

        if location is not None:
            stock_key = (item_key, location_name.lower(), station, rig.id if rig else None)
            if stock_key in self.seen_stock:
                result.error(f"Same item and location as row {self.seen_stock[stock_key]}.")
                return
            self.seen_stock[stock_key] = result.line

        if existing_item is None and planned is None:
            self.planned_items[item_key] = result.line
            result.action = "create"
        else:
            result.action = "update"
        result.data = {
            "item_key": item_key,
            "item": existing_item,
            "item_fields": item_fields,
            "location": location,
            "stock": stock,
        }

    def _location_exists(self, name, station_number_value, rig):
        for loc in self.locations_by_name.get(name.lower(), []):
            if rig and loc.apparatus_id == rig.id:
                return True
            if station_number_value and loc.station and loc.station.number.lower() == station_number_value.lower():
                return True
        return False

    def _get_location(self, spec):
        if spec[0] == "existing":
            return spec[1]
        _, name, station_value, rig = spec
        station = self.stations.get(station_value) if station_value else None
        location, _ = StorageLocation.objects.get_or_create(
            department=self.department,
            name=name,
            station=station,
            apparatus=rig,
        )
        return location

    def apply(self, result):
        d = result.data
        item = d["item"] or self.created_items.get(d["item_key"]) or Item(department=self.department)
        for name, value in d["item_fields"].items():
            setattr(item, name, value)
        item.save()
        self.created_items[d["item_key"]] = item

        if d["location"] is None:
            return
        location = self._get_location(d["location"])
        stock, _ = StockLevel.objects.get_or_create(department=self.department, item=item, location=location)
        changed = []
        for name in ("par_level", "expires_on"):
            if name in d["stock"]:
                setattr(stock, name, d["stock"][name])
                changed.append(name)
        if changed:
            stock.save(update_fields=changed + ["updated_at"])
        if "quantity" in d["stock"]:
            delta = d["stock"]["quantity"] - stock.quantity
            if delta:
                stock.adjust(delta, StockTransaction.Reason.COUNT, self.actor, "Imported")


IMPORTERS = {cls.kind: cls for cls in (PeopleImporter, ApparatusImporter, InventoryImporter)}
