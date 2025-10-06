import os
import cv2
import numpy as np
import pytesseract
import csv

# Requirements (install on Linux):
# sudo apt update && sudo apt install -y tesseract-ocr
# pip install opencv-python pytesseract numpy

IMG_DIR = ""  # adjust if images are in a subfolder
OUT_DIR = "."

pytesseract.pytesseract.tesseract_cmd = "tesseract"  # system tesseract

def sort_boxes(boxes):
    # sort by y then x
    boxes = sorted(boxes, key=lambda b: (b[1], b[0]))
    # cluster into rows by y coordinate
    rows = []
    tol = 10
    for b in boxes:
        x, y, w, h = b
        placed = False
        for row in rows:
            # compare y with first box in row
            if abs(y - row[0][1]) < max(tol, row[0][3]//2):
                row.append(b)
                placed = True
                break
        if not placed:
            rows.append([b])
    # sort boxes in each row by x
    rows = [sorted(r, key=lambda b: b[0]) for r in rows]
    return rows

def detect_cells(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # enhance
    gray = cv2.GaussianBlur(gray, (3,3), 0)
    th = cv2.adaptiveThreshold(gray,255,cv2.ADAPTIVE_THRESH_MEAN_C,cv2.THRESH_BINARY_INV,15,9)
    # remove small noise
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2,2))
    th = cv2.morphologyEx(th, cv2.MORPH_OPEN, kernel)
    # find contours (cells)
    contours, _ = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    boxes = []
    h_img, w_img = th.shape
    for c in contours:
        x,y,w,h = cv2.boundingRect(c)
        # filter by reasonable cell sizes (ignore very small/large)
        if 10 < w < w_img*0.9 and 10 < h < h_img*0.5:
            boxes.append((x,y,w,h))
    if not boxes:
        return []
    rows = sort_boxes(boxes)
    return rows

def ocr_cell(img_cell):
    # config optimized for digits, minus and small numbers
    config = r'--psm 7 -c tessedit_char_whitelist=-0123456789'
    txt = pytesseract.image_to_string(img_cell, config=config)
    txt = txt.strip().replace("\n"," ")
    return txt

def extract_grid_text(img_path):
    img = cv2.imread(img_path)
    if img is None:
        return []
    rows = detect_cells(img)
    if not rows:
        # fallback: OCR whole image line-by-line
        h,w,_ = img.shape
        lines = []
        # try splitting by horizontal projections
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        _,th = cv2.threshold(gray,0,255,cv2.THRESH_OTSU+cv2.THRESH_BINARY_INV)
        proj = np.sum(th, axis=1)
        thresh = max(1, int(0.05 * w))
        line_indices = np.where(proj > thresh)[0]
        if len(line_indices)==0:
            text = pytesseract.image_to_string(img, config='--psm 6')
            return [[s.strip() for s in text.splitlines() if s.strip()]]
        # cluster into bands
        bands = []
        cur = [line_indices[0]]
        for i in line_indices[1:]:
            if i - cur[-1] <= 2:
                cur.append(i)
            else:
                bands.append((cur[0], cur[-1]))
                cur = [i]
        bands.append((cur[0], cur[-1]))
        for a,b in bands:
            crop = img[max(0,a-3):min(h,b+3),:]
            txt = pytesseract.image_to_string(crop, config='--psm 7')
            if txt.strip():
                lines.append([txt.strip()])
        return lines
    grid_text = []
    for row in rows:
        row_texts = []
        for (x,y,w,h) in row:
            cell = img[y:y+h, x:x+w]
            txt = ocr_cell(cell)
            row_texts.append(txt)
        grid_text.append(row_texts)
    return grid_text

def normalize_and_write(grid, out_csv):
    # each row may have varying column counts. We will pad with empty strings to the max columns.
    if not grid:
        open(out_csv, "w").close()
        return
    maxc = max(len(r) for r in grid)
    with open(out_csv, "w", newline="") as f:
        writer = csv.writer(f)
        for r in grid:
            # simple clean: split multiple numbers stuck together by spaces
            cleaned = [c if c!='' else '' for c in r]
            if len(cleaned) < maxc:
                cleaned += [''] * (maxc - len(cleaned))
            writer.writerow(cleaned)

def main():
    for i in range(18,19):
        img_name = f"{i}.jpeg"
        img_path = os.path.join(IMG_DIR, img_name)
        out_csv = os.path.join(OUT_DIR, f"{i}.csv")
        grid = extract_grid_text(img_path)
        normalize_and_write(grid, out_csv)
        print(f"Wrote {out_csv} (rows: {len(grid)})")

if __name__ == "__main__":
    main()