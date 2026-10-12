import csv
import os
import sqlite3

D = os.path.dirname(os.path.abspath(__file__))
P = os.path.join(D, "parts.csv")
DB_PATH = os.path.join(D, "autopilot.db")
CITY = {
    "coimbatore": (11.0168, 76.9558),
    "chennai": (13.0827, 80.2707),
    "bengaluru": (12.9716, 77.5946),
    "mumbai": (19.076, 72.8777),
    "delhi": (28.6139, 77.209),
    "hyderabad": (17.385, 78.4867),
    "pune": (18.5204, 73.8567),
    "kochi": (9.9312, 76.2673),
}
SELL = [
    ("Rare Auto Spares", "Chennai", 1.0, 60, "In Stock", 4.5, 3, "12 months"),
    ("Heritage Parts Hub", "Bengaluru", 0.92, 90, "Limited", 4.2, 4, "6 months"),
    ("Classic Motor Depot", "Mumbai", 1.12, 120, "In Stock", 4.7, 5, "12 months"),
    ("South Auto Traders", "Kochi", 0.85, 50, "Order Only", 3.8, 8, "3 months"),
    ("Capital Car Parts", "Delhi", 1.05, 150, "In Stock", 4.4, 6, "6 months"),
]
PARTS = [
    ("Clutch Master Cylinder", "CMC-8801", "Maruti", "Gypsy", 1995, 2018, 2400),
    ("Front Wheel Bearing", "FWB-2210", "Tata", "Sumo", 1998, 2012, 1800),
    ("Power Steering Pump", "PSP-5532", "Mahindra", "Scorpio", 2002, 2014, 6800),
    ("Timing Chain Kit", "TCK-7714", "Hyundai", "Santro", 1998, 2010, 4200),
    ("ABS Sensor Front", "ABS-3309", "Honda", "City", 2003, 2013, 3100),
    ("Injector Set (4)", "INJ-9021", "Toyota", "Innova", 2005, 2015, 15500),
    ("Fuel Pump Assembly", "FPA-4467", "Ford", "Ikon", 2001, 2011, 5200),
    ("Instrument Cluster", "ICL-6608", "Volkswagen", "Polo", 2010, 2019, 9800),
    ("Water Pump", "WPM-1189", "Skoda", "Rapid", 2011, 2019, 3600),
    ("Turbocharger", "TRB-8823", "Mahindra", "Bolero", 2005, 2016, 21500),
    ("Gearbox Mount", "GBM-3345", "Maruti", "Zen", 1996, 2006, 1500),
    ("Radiator Fan Motor", "RFM-7702", "Hyundai", "Verna", 2006, 2013, 4600),
]
HEADERS = [
    "part_name", "part_number", "vehicle_brand", "vehicle_model", "year_from", "year_to", "seller_name",
    "seller_city", "seller_lat", "seller_lng", "price", "delivery_charge", "availability", "rating",
    "delivery_days", "warranty",
]


def make():
    if os.path.exists(P):
        return
    with open(P, "w", newline="", encoding="utf-8") as file_obj:
        writer = csv.writer(file_obj)
        writer.writerow(HEADERS)
        for i, (name, number, brand, model, start_year, end_year, price) in enumerate(PARTS):
            for j in range(4):
                seller = SELL[(i + j) % 5]
                city = seller[1].lower()
                lat, lng = CITY[city]
                writer.writerow([
                    name,
                    number,
                    brand,
                    model,
                    start_year,
                    end_year,
                    seller[0],
                    seller[1],
                    lat,
                    lng,
                    round(price * seller[2]),
                    seller[3],
                    seller[4],
                    seller[5],
                    seller[6],
                    seller[7],
                ])


def load():
    make()
    conn = sqlite3.connect(DB_PATH)
    conn.execute("CREATE TABLE IF NOT EXISTS parts (" + ", ".join(f"{h} TEXT" for h in HEADERS) + ")")
    conn.execute("DELETE FROM parts")
    with open(P, newline="", encoding="utf-8") as file_obj:
        rows = csv.DictReader(file_obj)
        for row in rows:
            conn.execute(
                "INSERT INTO parts (part_name, part_number, vehicle_brand, vehicle_model, year_from, year_to, seller_name, seller_city, seller_lat, seller_lng, price, delivery_charge, availability, rating, delivery_days, warranty) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    row["part_name"],
                    row["part_number"],
                    row["vehicle_brand"],
                    row["vehicle_model"],
                    int(float(row["year_from"])),
                    int(float(row["year_to"])),
                    row["seller_name"],
                    row["seller_city"],
                    float(row["seller_lat"]),
                    float(row["seller_lng"]),
                    int(float(row["price"])),
                    int(float(row["delivery_charge"])),
                    row["availability"],
                    float(row["rating"]),
                    int(float(row["delivery_days"])),
                    row["warranty"],
                ),
            )
    conn.commit()
    conn.close()
    print("Seeded", sum(1 for _ in open(P, encoding="utf-8")) - 1, "parts")


if __name__ == "__main__":
    load()
