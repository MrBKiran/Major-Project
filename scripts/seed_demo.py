#!/usr/bin/env python3
"""Seed demo vehicles into PostgreSQL"""
import asyncio, sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

DEMO_VEHICLES = [
    ("MH12AB1001","Bolero","B6",2021,"BATCH-MH-2023-Q4","PLANT-PUNE-01"),
    ("MH12AB1002","Thar","LX",2022,"BATCH-MH-2023-Q4","PLANT-PUNE-01"),
    ("KA03CD2001","Scorpio-N","Z8",2023,"BATCH-KA-2023-Q3","PLANT-NASHIK-01"),
    ("MH04EF3001","XUV700","AX7",2023,"BATCH-MH-2024-Q1","PLANT-PUNE-01"),
    ("TN09GH4001","Bolero","B4",2020,"BATCH-MH-2023-Q4","PLANT-PUNE-01"),
    ("DL01IJ5001","XUV300","W8",2022,"BATCH-KA-2023-Q3","PLANT-NASHIK-01"),
    ("MH02KL6001","Bolero","B6",2021,"BATCH-MH-2023-Q4","PLANT-PUNE-01"),
    ("GJ01MN7001","Thar","AX",2022,"BATCH-MH-2024-Q1","PLANT-PUNE-01"),
    ("RJ14OP8001","Scorpio","S5",2020,"BATCH-KA-2023-Q3","PLANT-NASHIK-01"),
    ("WB06QR9001","XUV700","MX",2023,"BATCH-MH-2024-Q1","PLANT-PUNE-01"),
]

async def seed():
    import asyncpg, os
    url = os.getenv("DATABASE_URL", "postgresql://autosaarthi:autosaarthi123@localhost:5432/autosaarthi")
    conn = await asyncpg.connect(url)
    for v in DEMO_VEHICLES:
        await conn.execute(
            """INSERT INTO vehicles (vin,model,variant,manufacture_year,batch_id,plant_id)
               VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING""", *v)
    print(f"Seeded {len(DEMO_VEHICLES)} vehicles.")
    await conn.close()

asyncio.run(seed())
