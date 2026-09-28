# ZEAZ Affiliate — Branding & GitHub Social Preview

## Assets

- [social-preview.svg](social-preview.svg) — Editable vector, 1280 × 640; สำหรับ README Banner และ Branding Source.
- `social-preview.png` — PNG 1280 × 640 ที่สร้างและส่งเป็นไฟล์ดาวน์โหลดในงานออกแบบนี้สำหรับ Upload ผ่าน GitHub Settings. GitHub Connector ที่เชื่อมอยู่ไม่มี Action สำหรับตั้งค่า Repository Social Preview โดยตรง จึง **ยังไม่ได้ Upload เข้าหน้า Settings**.

ภาพออกแบบ Dark Navy / Aqua / Purple; Concept UI บนภาพไม่แสดงยอดเงินจริง ไม่ใช่ Screenshot หรือหลักฐานว่า `zaff.zeaz.dev` พร้อมใช้งาน Production.

## Re-export from the committed SVG

แปลงเป็น PNG ขนาดที่ GitHub แนะนำได้ด้วย CairoSVG:

```bash
python -m pip install cairosvg
python -m cairosvg docs/brand/social-preview.svg -o docs/brand/social-preview.png -W 1280 -H 640
```

ตรวจสอบ PNG ต้องมีขนาดอย่างน้อย 640 × 320; แนะนำ **1280 × 640**, อัตราส่วน 2:1, PNG/JPEG/JPG. เวอร์ชันที่แนบมาเป็น PNG 1280 × 640.

## Upload Social Preview

1. เปิด [Repository Settings](https://github.com/cvsz/zaffiliate/settings) ด้วยบัญชีที่มี Admin Permission.
2. เลือก **General → Social preview → Edit / Upload an image** (ตำแหน่งและข้อความอาจเปลี่ยนตาม GitHub UI).
3. เลือก PNG 1280 × 640 ที่ดาวน์โหลดไว้และ Save. ตรวจผลการแสดงผลจากการ Share URL ใหม่.
4. อย่าสับสนกับ README Banner: การ Commit SVG/PNG หรือเพิ่ม Open Graph Tags ใน Web App **ไม่เปลี่ยนค่า Social Preview ของ GitHub Repository**.

## Badge policy

- CI / CodeQL / Dependency Review: ใช้ GitHub Actions badge ของ `main` (Dynamic).
- Node.js Version / MIT: อ้างอิง `package.json` และ `LICENSE` ตาม Source.
- Production: คง `Release Gated` จนผ่าน Operator Sign-off และ Evidence.
- ห้ามใช้ `production ready`, `approved on TikTok/Shopee`, `live revenue`, `all tests passed` แบบ Static โดยไม่มีหลักฐานร่วมสมัย.
