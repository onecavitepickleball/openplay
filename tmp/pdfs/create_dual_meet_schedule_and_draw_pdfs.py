from collections import defaultdict
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate, Frame, KeepTogether, PageBreak, Paragraph, Spacer, Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output' / 'pdf'
OUT.mkdir(parents=True, exist_ok=True)
SCHEDULE_OUT = OUT / 'OCPC-Rally-Rebels-Court-Schedules-2026.pdf'
DRAW_OUT = OUT / 'OCPC-Rally-Rebels-Official-Matchups-2026.pdf'

OCPC_LOGO = ROOT / 'assets' / 'logo-2026.png'
RALLY_LOGO = Path('/Users/jeymskastilyo/iCloud Drive (Archive)/Desktop/PICKLEBALL/OCPC/OCPC x RR/rr-logo-front.png')

# Current Match Control schedule, captured from the live Operations Pack on September 16, 2026.
# Columns: time | category | OCPC pair code | Rally Rebels pair code | stage
COURTS = {
    1: '''10:30 AM|Novice|O6|R3|5-Game Format
10:45 AM|Low Intermediate|O2|R4|5-Game Format
11:00 AM|High Intermediate|O2|R6|5-Game Format
11:15 AM|Novice|O3|R2|5-Game Format
11:30 AM|Low Intermediate|O3|R4|5-Game Format
11:45 AM|High Intermediate|O3|R5|5-Game Format
12:00 PM|Novice|O5|R1|5-Game Format
12:15 PM|Low Intermediate|O5|R6|5-Game Format
12:30 PM|High Intermediate|O4|R4|5-Game Format
12:45 PM|Novice|O1|R4|5-Game Format
1:00 PM|Low Intermediate|O1|R2|5-Game Format
1:15 PM|High Intermediate|O4|R3|5-Game Format
1:30 PM|Novice|O4|R2|5-Game Format
1:45 PM|Low Intermediate|O6|R1|5-Game Format
2:00 PM|High Intermediate|O3|R1|5-Game Format
2:15 PM|Novice|O1|R2|5-Game Format
2:30 PM|Low Intermediate|O3|R2|5-Game Format
2:45 PM|High Intermediate|O1|R5|5-Game Format
3:00 PM|Novice|TBD|TBD|Bronze / 4th Place
3:15 PM|Novice|TBD|TBD|Gold / Silver''',
    2: '''10:30 AM|Low Intermediate|O3|R6|5-Game Format
10:45 AM|High Intermediate|O4|R5|5-Game Format
11:00 AM|Novice|O1|R1|5-Game Format
11:15 AM|Low Intermediate|O5|R3|5-Game Format
11:30 AM|High Intermediate|O5|R4|5-Game Format
11:45 AM|Novice|O2|R4|5-Game Format
12:00 PM|Low Intermediate|O6|R2|5-Game Format
12:15 PM|High Intermediate|O5|R1|5-Game Format
12:30 PM|Novice|O4|R5|5-Game Format
12:45 PM|Low Intermediate|O2|R3|5-Game Format
1:00 PM|High Intermediate|O6|R1|5-Game Format
1:15 PM|Novice|O6|R5|5-Game Format
1:30 PM|Low Intermediate|O2|R6|5-Game Format
1:45 PM|High Intermediate|O2|R4|5-Game Format
2:00 PM|Novice|O5|R6|5-Game Format
2:15 PM|Low Intermediate|O2|R5|5-Game Format
2:30 PM|High Intermediate|O5|R6|5-Game Format
2:45 PM|Novice|O4|R1|5-Game Format''',
    3: '''10:30 AM|High Intermediate|O5|R2|5-Game Format
10:45 AM|Novice|O2|R5|5-Game Format
11:00 AM|Low Intermediate|O6|R5|5-Game Format
11:15 AM|High Intermediate|O1|R1|5-Game Format
11:30 AM|Novice|O4|R3|5-Game Format
11:45 AM|Low Intermediate|O4|R5|5-Game Format
12:00 PM|High Intermediate|O6|R6|5-Game Format
12:15 PM|Novice|O3|R6|5-Game Format
12:30 PM|Low Intermediate|O4|R1|5-Game Format
12:45 PM|High Intermediate|O2|R5|5-Game Format
1:00 PM|Novice|O3|R1|5-Game Format
1:15 PM|Low Intermediate|O3|R3|5-Game Format
1:30 PM|High Intermediate|O5|R5|5-Game Format
1:45 PM|Novice|O3|R4|5-Game Format
2:00 PM|Low Intermediate|O1|R4|5-Game Format
2:15 PM|High Intermediate|O1|R3|5-Game Format
2:30 PM|Novice|O3|R5|5-Game Format
2:45 PM|Low Intermediate|O5|R1|5-Game Format
3:00 PM|Low Intermediate|TBD|TBD|Bronze / 4th Place
3:15 PM|Low Intermediate|TBD|TBD|Gold / Silver''',
    4: '''10:30 AM|Novice|O4|R6|5-Game Format
10:45 AM|Low Intermediate|O4|R2|5-Game Format
11:00 AM|High Intermediate|O6|R3|5-Game Format
11:15 AM|Novice|O6|R6|5-Game Format
11:30 AM|Low Intermediate|O2|R1|5-Game Format
11:45 AM|High Intermediate|O2|R3|5-Game Format
12:00 PM|Novice|O6|R2|5-Game Format
12:15 PM|Low Intermediate|O3|R5|5-Game Format
12:30 PM|High Intermediate|O3|R3|5-Game Format
12:45 PM|Novice|O5|R2|5-Game Format
1:00 PM|Low Intermediate|O5|R5|5-Game Format
1:15 PM|High Intermediate|O3|R2|5-Game Format
1:30 PM|Novice|O1|R3|5-Game Format
1:45 PM|Low Intermediate|O5|R2|5-Game Format
2:00 PM|High Intermediate|O6|R2|5-Game Format
2:15 PM|Novice|O6|R4|5-Game Format
2:30 PM|Low Intermediate|O6|R6|5-Game Format
2:45 PM|High Intermediate|O6|R4|5-Game Format''',
    5: '''10:30 AM|Low Intermediate|O1|R1|5-Game Format
10:45 AM|High Intermediate|O3|R4|5-Game Format
11:00 AM|Novice|O5|R4|5-Game Format
11:15 AM|Low Intermediate|O1|R6|5-Game Format
11:30 AM|High Intermediate|O4|R2|5-Game Format
11:45 AM|Novice|O1|R5|5-Game Format
12:00 PM|Low Intermediate|O1|R3|5-Game Format
12:15 PM|High Intermediate|O1|R2|5-Game Format
12:30 PM|Novice|O2|R3|5-Game Format
12:45 PM|Low Intermediate|O6|R4|5-Game Format
1:00 PM|High Intermediate|O1|R6|5-Game Format
1:15 PM|Novice|O2|R6|5-Game Format
1:30 PM|Low Intermediate|O4|R4|5-Game Format
1:45 PM|High Intermediate|O4|R6|5-Game Format
2:00 PM|Novice|O2|R1|5-Game Format
2:15 PM|Low Intermediate|O4|R3|5-Game Format
2:30 PM|High Intermediate|O2|R1|5-Game Format
2:45 PM|Novice|O5|R3|5-Game Format
3:00 PM|High Intermediate|TBD|TBD|Bronze / 4th Place
3:15 PM|High Intermediate|TBD|TBD|Gold / Silver''',
}

PAIRS = {
    'Novice': {
        'O1':'Vience / Ariane', 'O2':'Nat / JM', 'O3':'Marc / Jephel', 'O4':'Sia / Jason', 'O5':'TJ / Cha', 'O6':'Cristine / Renz',
        'R1':'Aybi Arcilla / Corena Ybanez', 'R2':'Candy Tapuro / Madelaine Fauni', 'R3':'Patricia Cabahug / Carla Supan', 'R4':'Mai Valencia / Gabe Basanez', 'R5':'Riza Castro / Myell Pasco', 'R6':'AJ Fauni / Allen Casin',
    },
    'Low Intermediate': {
        'O1':'Kenneth / Rbetz', 'O2':'Marvin / Venven', 'O3':'Timmy / Riyang', 'O4':'Mark / Ann', 'O5':'Antony / Jehiel', 'O6':'Neil / Sean',
        'R1':'Jopo Jalea / Gerald', 'R2':'Via Gavino / Bernie Pingol', 'R3':'Alyssa Cruz / Jaja Barabat', 'R4':'Brian Manching / Cherry Marmolejo', 'R5':'Alison / Merry Grace', 'R6':'MK Licos / Leng Santos',
    },
    'High Intermediate': {
        'O1':'Lanze / Carl', 'O2':'Jonas / Greg', 'O3':'James / Uzz', 'O4':'JS / Harvey', 'O5':'Gem / Josh', 'O6':'Joe / Maru',
        'R1':'Kian Jocson / AJ Reyes', 'R2':'Kim Santos / Art Reyes', 'R3':'MJ de Leon / John Hilaga', 'R4':'Pipo Gamis / Kevin Kaspog', 'R5':'Aaron Arcilla / Ryan Hermida', 'R6':'Rufino Malanyaon / Dan Ringor',
    },
}

NAVY = colors.HexColor('#082a3e')
BLUE = colors.HexColor('#0b668f')
LIME = colors.HexColor('#bbff37')
GREEN = colors.HexColor('#1a9b65')
GOLD = colors.HexColor('#e5a21a')
RED = colors.HexColor('#c75151')
INK = colors.HexColor('#102c3d')
MIST = colors.HexColor('#eef4f7')
LINE = colors.HexColor('#c9d8df')

def parse_courts():
    result = {}
    for court, source in COURTS.items():
        result[court] = [dict(zip(('time','category','ocpc','rally','stage'), line.split('|'))) for line in source.splitlines()]
    return result

SCHEDULE = parse_courts()

def para(text, style):
    return Paragraph(text, style)

styles = getSampleStyleSheet()
TITLE = ParagraphStyle('Title', parent=styles['Normal'], fontName='Helvetica-Bold', fontSize=22, leading=24, textColor=NAVY)
SUB = ParagraphStyle('Sub', parent=styles['Normal'], fontName='Helvetica', fontSize=8.5, leading=10.5, textColor=colors.HexColor('#52707f'))
COURT_TITLE = ParagraphStyle('CourtTitle', parent=styles['Normal'], fontName='Helvetica-Bold', fontSize=18, leading=20, textColor=colors.white)
CELL = ParagraphStyle('Cell', parent=styles['Normal'], fontName='Helvetica', fontSize=7.15, leading=8.3, textColor=INK)
CELL_BOLD = ParagraphStyle('CellBold', parent=CELL, fontName='Helvetica-Bold')
SMALL = ParagraphStyle('Small', parent=styles['Normal'], fontName='Helvetica', fontSize=6.7, leading=8, textColor=colors.HexColor('#52707f'))
WHITE = ParagraphStyle('White', parent=SUB, textColor=colors.white)
SCHEDULE_PAIR = ParagraphStyle('SchedulePair', parent=styles['Normal'], fontName='Helvetica', fontSize=5.8, leading=6.6, textColor=INK)
SCHEDULE_META = ParagraphStyle('ScheduleMeta', parent=styles['Normal'], fontName='Helvetica-Bold', fontSize=6.2, leading=7, textColor=INK)
DRAW_TITLE = ParagraphStyle('DrawTitle', parent=TITLE, fontSize=23, leading=26)
DRAW_PAIR = ParagraphStyle('DrawPair', parent=styles['Normal'], fontName='Helvetica-Bold', fontSize=8.5, leading=10, textColor=INK)
DRAW_OPP = ParagraphStyle('DrawOpp', parent=styles['Normal'], fontName='Helvetica', fontSize=7.3, leading=9, textColor=INK)

def header(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.rect(0, A4[0] - 12*mm, landscape(A4)[0], 12*mm, fill=1, stroke=0)
    canvas.setFillColor(colors.white)
    canvas.setFont('Helvetica-Bold', 7.5)
    canvas.drawString(13*mm, landscape(A4)[1] - 8*mm, 'OCPC × RALLY REBELS CLUB DUAL MEET')
    canvas.setFont('Helvetica', 6.5)
    canvas.drawRightString(landscape(A4)[0] - 13*mm, landscape(A4)[1] - 8*mm, 'September 19, 2026 · Rally District PH · Kawit, Cavite')
    canvas.setFont('Helvetica', 6.2)
    canvas.setFillColor(colors.HexColor('#52707f'))
    canvas.drawRightString(landscape(A4)[0] - 13*mm, 8*mm, f'Official matchday document · Page {doc.page}')
    canvas.restoreState()

def document(path):
    page = landscape(A4)
    return BaseDocTemplate(str(path), pagesize=page, leftMargin=13*mm, rightMargin=13*mm, topMargin=19*mm, bottomMargin=14*mm, title='OCPC × Rally Rebels Club Dual Meet', author='One Cavite Pickleball Club', pageTemplates=[])

def build_schedule():
    doc = document(SCHEDULE_OUT)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='normal')
    from reportlab.platypus import PageTemplate
    doc.addPageTemplates(PageTemplate(id='court', frames=[frame], onPage=header))
    story = []
    for court, matches in SCHEDULE.items():
        title = Table([[para(f'COURT {court}', COURT_TITLE), para('5-GAME FORMAT · COURT SCHEDULE', WHITE)]], colWidths=[52*mm, 206*mm])
        title.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),NAVY),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7)]))
        story += [title, Spacer(1,2.5*mm), para('Match calls and final score recording. Medal-round placeholders follow the 5-Game Format schedule.', SUB), Spacer(1,1.8*mm)]
        rows = [[para('TIME', SCHEDULE_META), para('CATEGORY', SCHEDULE_META), para('OCPC', SCHEDULE_META), para('RALLY REBELS', SCHEDULE_META), para('STAGE', SCHEDULE_META), para('FINAL SCORE', SCHEDULE_META)]]
        for m in matches:
            ocpc = 'TBD' if m['ocpc'] == 'TBD' else f"<b>{m['ocpc']}</b> · {PAIRS[m['category']][m['ocpc']]}"
            rally = 'TBD' if m['rally'] == 'TBD' else f"<b>{m['rally']}</b> · {PAIRS[m['category']][m['rally']]}"
            stage_color = GOLD if 'Bronze' in m['stage'] or 'Gold' in m['stage'] else BLUE
            rows.append([para(m['time'], SCHEDULE_META), para(m['category'], SCHEDULE_PAIR), para(ocpc, SCHEDULE_PAIR), para(rally, SCHEDULE_PAIR), para(f'<font color="{stage_color.hexval()}"><b>{m["stage"]}</b></font>', SCHEDULE_PAIR), para('____  –  ____', SCHEDULE_META)])
        table = Table(rows, colWidths=[22*mm, 30*mm, 68*mm, 68*mm, 38*mm, 28*mm], repeatRows=1)
        table.setStyle(TableStyle([
            ('BACKGROUND',(0,0),(-1,0),colors.HexColor('#dbeaf0')), ('TEXTCOLOR',(0,0),(-1,0),NAVY),
            ('GRID',(0,0),(-1,-1),0.35,LINE), ('VALIGN',(0,0),(-1,-1),'MIDDLE'),
            ('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white, MIST]),
            ('TOPPADDING',(0,1),(-1,-1),2.8), ('BOTTOMPADDING',(0,1),(-1,-1),2.8),
            ('LEFTPADDING',(0,0),(-1,-1),4), ('RIGHTPADDING',(0,0),(-1,-1),4),
        ]))
        story.append(table)
        story += [Spacer(1,2*mm), para('5-Game Format: first to 11, win by 2, sudden death at 10–10. Medal matches use the event’s configured medal rules.', SMALL)]
        if court != max(SCHEDULE): story.append(PageBreak())
    doc.build(story)

def draw_rows(category):
    played = defaultdict(set)
    for matches in SCHEDULE.values():
        for match in matches:
            if match['category'] == category and match['ocpc'] != 'TBD':
                played[match['ocpc']].add(match['rally'])
                played[match['rally']].add(match['ocpc'])
    all_o = [f'O{i}' for i in range(1,7)]
    all_r = [f'R{i}' for i in range(1,7)]
    return played, all_o, all_r

def matchup_cell(category, code, opponents):
    name = PAIRS[category][code]
    opponent_text = '<br/>'.join(f'<b>{op}</b> · {PAIRS[category][op]}' for op in opponents)
    other_codes = [f'R{i}' for i in range(1,7)] if code.startswith('O') else [f'O{i}' for i in range(1,7)]
    excluded = next(item for item in other_codes if item not in opponents)
    return [para(f'<b>{code}</b> · {name}', DRAW_PAIR), para(opponent_text, DRAW_OPP), para(f'<b>Not scheduled:</b> {excluded} · {PAIRS[category][excluded]}', ParagraphStyle('Excluded', parent=DRAW_OPP, textColor=RED))]

def build_draw():
    doc = document(DRAW_OUT)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='normal')
    from reportlab.platypus import PageTemplate
    doc.addPageTemplates(PageTemplate(id='draw', frames=[frame], onPage=header))
    story = []
    for idx, category in enumerate(('Novice','Low Intermediate','High Intermediate')):
        played, ocpc_codes, rally_codes = draw_rows(category)
        story += [para('OFFICIAL MATCHUP RESULTS', DRAW_TITLE), Spacer(1,1.5*mm), para(f'{category} · Draw ID 0A8F287198FC · Locked in Match Control', SUB), Spacer(1,4*mm)]
        note = Table([[para('<b>How to read this page</b><br/>Every pair is guaranteed five 5-Game Format matches against the opposing club. The highlighted line shows the one opponent they will not meet during elimination play.', CELL)]], colWidths=[258*mm])
        note.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),colors.HexColor('#fff5db')),('BOX',(0,0),(-1,-1),0.5,GOLD),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6)]))
        story += [note, Spacer(1,4*mm)]
        rows = [[para('OCPC PAIR', CELL_BOLD), para('FIVE SCHEDULED RALLY REBELS OPPONENTS', CELL_BOLD), para('EXCLUSION', CELL_BOLD), para('RALLY REBELS PAIR', CELL_BOLD), para('FIVE SCHEDULED OCPC OPPONENTS', CELL_BOLD), para('EXCLUSION', CELL_BOLD)]]
        for o, r in zip(ocpc_codes, rally_codes):
            left = matchup_cell(category, o, sorted(played[o]))
            right = matchup_cell(category, r, sorted(played[r]))
            rows.append([left[0],left[1],left[2],right[0],right[1],right[2]])
        table = Table(rows, colWidths=[34*mm,64*mm,31*mm,34*mm,64*mm,31*mm], repeatRows=1)
        table.setStyle(TableStyle([
            ('BACKGROUND',(0,0),(-1,0),colors.HexColor('#dbeaf0')), ('GRID',(0,0),(-1,-1),0.35,LINE),
            ('VALIGN',(0,0),(-1,-1),'TOP'), ('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,MIST]),
            ('TOPPADDING',(0,1),(-1,-1),6),('BOTTOMPADDING',(0,1),(-1,-1),6),('LEFTPADDING',(0,0),(-1,-1),4),('RIGHTPADDING',(0,0),(-1,-1),4),
        ]))
        story += [table, Spacer(1,4*mm), para('The matchup list above is derived from the active official schedule and is the player-facing record for this category.', SMALL)]
        if idx < 2: story.append(PageBreak())
    doc.build(story)

if __name__ == '__main__':
    build_schedule()
    build_draw()
    print(SCHEDULE_OUT)
    print(DRAW_OUT)
