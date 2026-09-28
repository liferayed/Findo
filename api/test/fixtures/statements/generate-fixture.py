"""Regenerates synthetic-checking-statement-page1.png.

Not run by any test or build step — kept here purely so the fixture is reproducible and so
reviewers can see exactly how it was built (a plain white PNG with programmatically-rendered
text, no real bank's layout or any real person's data). Run manually with:

    python3 generate-fixture.py

Requires Pillow (`pip install pillow`) and a system font (Helvetica/Menlo on macOS; substitute
any installed TrueType font on other platforms).
"""

from PIL import Image, ImageDraw, ImageFont

W, H = 1700, 2200  # ~200 DPI for a US letter page (8.5x11in), matching the design doc's spike

img = Image.new("RGB", (W, H), "white")
draw = ImageDraw.Draw(img)

title_font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 42)
header_font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 28)
row_font = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 26)

y = 80
draw.text((80, y), "FINDO TEST BANK", font=title_font, fill="black")
y += 70
draw.text((80, y), "Checking Account Statement", font=header_font, fill="black")
y += 50
draw.text((80, y), "Account ending in 4821", font=header_font, fill="black")
y += 50
draw.text((80, y), "Statement Period: 2026-08-01 to 2026-08-31", font=header_font, fill="black")
y += 60
draw.text((80, y), "Beginning Balance: $1,204.55", font=header_font, fill="black")
y += 45
draw.text((80, y), "Ending Balance: $987.10", font=header_font, fill="black")
y += 70

draw.line([(80, y), (1620, y)], fill="black", width=2)
y += 30
draw.text((80, y), "DATE", font=header_font, fill="black")
draw.text((300, y), "DESCRIPTION", font=header_font, fill="black")
draw.text((1200, y), "AMOUNT", font=header_font, fill="black")
y += 40
draw.line([(80, y), (1620, y)], fill="black", width=2)
y += 30

rows = [
    ("2026-08-02", "SYNTHETIC GROCERY CO", -54.32),
    ("2026-08-05", "PAYROLL DEPOSIT ACME CORP", 1500.00),
    ("2026-08-09", "SYNTHETIC ELECTRIC UTILITY", -110.00),
    ("2026-08-14", "COFFEE SHOP TEST MERCHANT", -6.75),
    ("2026-08-20", "ONLINE RETAILER PURCHASE", -89.42),
    ("2026-08-27", "TRANSFER TO SAVINGS", -300.00),
]

for date, desc, amt in rows:
    draw.text((80, y), date, font=row_font, fill="black")
    draw.text((300, y), desc, font=row_font, fill="black")
    draw.text((1200, y), f"{amt:,.2f}", font=row_font, fill="black")
    y += 44

img.save("synthetic-checking-statement-page1.png", dpi=(200, 200))
print("saved", img.size)
