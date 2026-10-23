import datetime
import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.apparatus.models import Apparatus
from apps.core.models import Station, User
from apps.inventory.models import Item, StockLevel, StockTransaction
from apps.scheduling.models import Assignment, Platoon


def csv_file(text, name="data.csv"):
    return SimpleUploadedFile(name, text.encode("utf-8-sig"), content_type="text/csv")


def upload(client, kind, file, **flags):
    data = {"file": file, **{k: "true" for k, v in flags.items() if v}}
    return client.post(f"/api/v1/imports/{kind}/", data, format="multipart")


@pytest.fixture
def admin(client_for, admin_user):
    return client_for(admin_user)


# ---------------------------------------------------------------- People

PEOPLE = """Name,Badge,Rank,Shift,Station,Position,Email
"Rivera, Alex",1042,Firefighter,A,Station 1,FF,arivera@city.gov
Sam Ortiz,1043,Captain,B Shift,3,Capt.,sortiz@city.gov
"""


def test_people_preview_writes_nothing(admin, department):
    report = upload(admin, "people", csv_file(PEOPLE)).json()
    assert report["committed"] is False
    assert report["summary"] == {"create": 2, "update": 0, "skip": 0, "error": 0}
    assert report["recognized"] == {
        "Name": "Name",
        "Badge": "Employee ID",
        "Rank": "Rank",
        "Shift": "Platoon",
        "Station": "Station",
        "Position": "Position",
        "Email": "Email",
    }
    assert "Creates Station 3" in report["rows"][1]["notes"]
    assert not User.objects.filter(employee_id="1042").exists()


def test_people_commit(admin, department, station):
    report = upload(admin, "people", csv_file(PEOPLE), commit=True).json()
    assert report["committed"] is True
    alex = User.objects.get(employee_id="1042")
    assert (alex.first_name, alex.last_name, alex.username) == ("Alex", "Rivera", "riverside-arivera")
    assert alex.role == "member"
    assert not alex.has_usable_password()
    assert alex.home_station == station
    sam = User.objects.get(employee_id="1043")
    # Rank never grants app access: a captain still imports as a member.
    assert sam.role == "member"
    assert sam.assignment.position == Assignment.Position.CAPTAIN
    assert sam.assignment.platoon.code == "B"
    assert sam.assignment.station.number == "3"
    assert set(Platoon.objects.filter(department=department).values_list("code", flat=True)) == {"A", "B"}


def test_people_reimport_updates_instead_of_duplicating(admin, department):
    upload(admin, "people", csv_file(PEOPLE), commit=True)
    changed = "Employee ID,Phone,App role\n1042,555-0199,officer\n"
    report = upload(admin, "people", csv_file(changed), commit=True).json()
    assert report["summary"]["update"] == 1
    alex = User.objects.get(employee_id="1042")
    assert alex.phone == "555-0199"
    assert alex.role == "officer"
    assert alex.first_name == "Alex"  # blank cells don't wipe existing values
    assert User.objects.filter(department=department, employee_id="1042").count() == 1


def test_people_errors_block_commit_unless_skipped(admin, department):
    bad = "First name,Last name,App role\nPat,Lee,superuser\nJo,Kim,member\nJo,Kim,member\n"
    report = upload(admin, "people", csv_file(bad), commit=True).json()
    assert report["committed"] is False
    assert report["summary"] == {"create": 1, "update": 0, "skip": 0, "error": 2}
    assert "App role" in report["rows"][0]["errors"][0]
    assert report["rows"][2]["errors"] == ["Same person as row 3."]
    assert not User.objects.filter(last_name="Kim").exists()

    report = upload(admin, "people", csv_file(bad), commit=True, skip_errors=True).json()
    assert report["committed"] is True
    assert User.objects.filter(last_name="Kim").count() == 1


def test_people_cannot_take_over_another_departments_user(admin, make_user, other_department):
    make_user("lakeview-jdoe", dept=other_department)
    report = upload(admin, "people", csv_file("Username,First name\nlakeview-jdoe,Jane\n"), commit=True).json()
    assert report["committed"] is False
    assert "another department" in report["rows"][0]["errors"][0]


# ---------------------------------------------------------------- Apparatus

FLEET = """Unit #,Vehicle Type,Station,Status,Odometer,Year,Make
E1,Pumper,1,Front line,"41,250",2019,Pierce
M1,Medic,1,In Service,36400,2022,Horton
T1,Truck,2,Spare,58900,2015,E-ONE
B1,Brush Truck,2,OOS,,2010,Ford
WT5,Water Tender,2,,12000,2008,Kenworth
"""


def test_apparatus_import_maps_common_names(admin, department, station):
    report = upload(admin, "apparatus", csv_file(FLEET), commit=True).json()
    assert report["summary"]["create"] == 5, report
    rigs = {a.unit_number: a for a in Apparatus.objects.filter(department=department)}
    assert {u: a.apparatus_type for u, a in rigs.items()} == {
        "E1": "engine",
        "M1": "ambulance",
        "T1": "ladder",
        "B1": "brush",
        "WT5": "tender",
    }
    assert rigs["E1"].mileage == 41250
    assert rigs["T1"].status == "reserve"
    assert rigs["B1"].status == "out_of_service"
    assert rigs["WT5"].station.number == "2"
    assert Station.objects.filter(department=department, number="2").exists()


def test_apparatus_reimport_updates(admin, department):
    upload(admin, "apparatus", csv_file(FLEET), commit=True)
    report = upload(admin, "apparatus", csv_file("Unit,Mileage\ne1,42000\n"), commit=True).json()
    assert report["summary"]["update"] == 1
    assert Apparatus.objects.get(department=department, unit_number="E1").mileage == 42000


def test_apparatus_row_errors(admin):
    report = upload(
        admin, "apparatus", csv_file("Unit,Type,Year\nX1,Hovercraft,2020\nX2,Engine,1820\nX3,,2020\n")
    ).json()
    errors = [r["errors"][0] for r in report["rows"]]
    assert "Type: don't know “Hovercraft”" in errors[0]
    assert "Year 1820" in errors[1]
    assert errors[2] == "Type is required for new apparatus."


def test_missing_required_column_is_reported(admin):
    report = upload(admin, "apparatus", csv_file("Make,Model\nPierce,Enforcer\n")).json()
    assert report["missing"] == ["Unit number"]
    assert report["rows"] == []


# ---------------------------------------------------------------- Inventory

STOCK = """Item Description,Category,UOM,Part Number,Storage Location,Station,Qty On Hand,Reorder Point,Exp Date
Nitrile gloves L,Medical,box,NGL-L,EMS supply room,1,12,10,
Normal saline 1000 mL,EMS,bag,NS-1000,EMS supply room,1,18,20,03/31/2027
Halligan bar,Tools,each,HB-30,,,,,
"""


def test_inventory_import_creates_items_locations_and_logged_stock(admin, department, admin_user):
    report = upload(admin, "inventory", csv_file(STOCK), commit=True).json()
    assert report["committed"] is True, report
    assert report["summary"]["create"] == 3
    saline = StockLevel.objects.get(item__name="Normal saline 1000 mL")
    assert (saline.quantity, saline.par_level) == (18, 20)
    assert saline.expires_on == datetime.date(2027, 3, 31)
    assert saline.location.station.number == "1"
    txn = StockTransaction.objects.get(stock=saline)
    assert (txn.change, txn.reason, txn.performed_by) == (18, "count", admin_user)
    assert Item.objects.get(name="Halligan bar").category == "tools"
    assert not StockLevel.objects.filter(item__name="Halligan bar").exists()


def test_inventory_reimport_adjusts_by_the_difference(admin):
    upload(admin, "inventory", csv_file(STOCK), commit=True)
    recount = "Item,Location,Station,Quantity\nNitrile gloves L,EMS supply room,1,7\n"
    report = upload(admin, "inventory", csv_file(recount), commit=True).json()
    assert report["summary"]["update"] == 1
    gloves = StockLevel.objects.get(item__name="Nitrile gloves L")
    assert gloves.quantity == 7
    assert list(gloves.transactions.values_list("change", flat=True).order_by("id")) == [12, -5]
    assert Item.objects.filter(name="Nitrile gloves L").count() == 1


def test_inventory_location_needs_an_owner(admin):
    report = upload(admin, "inventory", csv_file("Item,Location,Quantity\nGauze,Closet,4\n")).json()
    assert "needs a Station or Apparatus" in report["rows"][0]["errors"][0]


def test_inventory_unknown_apparatus(admin):
    report = upload(admin, "inventory", csv_file("Item,Apparatus,Quantity\nGauze,Z9,4\n")).json()
    assert "No apparatus “Z9”" in report["rows"][0]["errors"][0]


def test_inventory_on_a_rig(admin, department):
    Apparatus.objects.create(department=department, unit_number="M1", apparatus_type="ambulance")
    report = upload(admin, "inventory", csv_file("Item,Apparatus,Quantity\nGauze,M1,4\n"), commit=True).json()
    assert report["committed"] is True
    stock = StockLevel.objects.get(item__name="Gauze")
    assert stock.location.apparatus.unit_number == "M1"
    assert stock.location.name == "Main compartment"


# ---------------------------------------------------------------- Files and access


def test_excel_files_with_real_dates(admin):
    from openpyxl import Workbook

    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["Item", "Location", "Station", "Quantity", "Expires"])
    sheet.append(["Epinephrine 1mg", "Drug box", 1, 6, datetime.datetime(2027, 1, 15)])
    buffer = io.BytesIO()
    workbook.save(buffer)
    file = SimpleUploadedFile("stock.xlsx", buffer.getvalue())
    report = upload(admin, "inventory", file, commit=True).json()
    assert report["committed"] is True, report
    stock = StockLevel.objects.get(item__name="Epinephrine 1mg")
    assert (stock.quantity, stock.expires_on) == (6, datetime.date(2027, 1, 15))


def test_bad_files(admin):
    assert upload(admin, "people", SimpleUploadedFile("x.pdf", b"%PDF")).status_code == 400
    assert upload(admin, "people", SimpleUploadedFile("x.xls", b"old")).json()["file"][0].startswith("Old .xls")
    assert upload(admin, "people", csv_file("\n\n")).json()["file"] == ["The file is empty."]
    assert admin.post("/api/v1/imports/people/", {}, format="multipart").status_code == 400
    assert upload(admin, "spaceships", csv_file("a\n1\n")).status_code == 404


def test_semicolon_csv_from_european_excel(admin, department):
    report = upload(admin, "apparatus", csv_file("Unit;Type\nE7;Engine\n"), commit=True).json()
    assert report["committed"] is True
    assert Apparatus.objects.filter(department=department, unit_number="E7").exists()


def test_only_admins_can_import(client_for, officer):
    assert upload(client_for(officer), "people", csv_file(PEOPLE)).status_code == 403
    assert client_for(officer).get("/api/v1/imports/").status_code == 403


def test_kinds_and_templates(admin):
    kinds = admin.get("/api/v1/imports/").json()
    assert [k["kind"] for k in kinds] == ["people", "apparatus", "inventory"]
    response = admin.get("/api/v1/imports/apparatus/template/")
    assert response["Content-Type"] == "text/csv"
    header, example = response.content.decode().strip().splitlines()
    assert header.startswith("Unit number,Type,Station")
    assert example.startswith("E1,Engine,1")


def test_imports_are_audited(admin, admin_user):
    from apps.audit.models import AuditEntry

    upload(admin, "apparatus", csv_file("Unit,Type\nE9,Engine\n"), commit=True)
    entry = AuditEntry.objects.get(model="apparatus.Apparatus", object_repr="E9")
    assert entry.actor == admin_user


def test_command_line_import(tmp_path, department):
    from django.core.management import call_command

    path = tmp_path / "fleet.csv"
    path.write_text("Unit,Type\nE5,Engine\n")
    out = io.StringIO()
    call_command("import_data", "riverside", "apparatus", str(path), stdout=out)
    assert "Dry run" in out.getvalue()
    assert not Apparatus.objects.filter(unit_number="E5").exists()
    call_command("import_data", "riverside", "apparatus", str(path), "--commit", stdout=out)
    assert Apparatus.objects.filter(department=department, unit_number="E5").exists()
