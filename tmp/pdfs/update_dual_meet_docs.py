from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether, Image
from reportlab.lib.colors import HexColor
from reportlab.graphics.barcode import qr
from reportlab.graphics.shapes import Drawing

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output' / 'pdf'
OUT.mkdir(parents=True, exist_ok=True)
LOGO = ROOT / 'assets' / 'logo-2026.png'
RR_LOGO = Path('/Users/jeymskastilyo/iCloud Drive (Archive)/Desktop/PICKLEBALL/OCPC/OCPC x RR/rr-logo-front.png')

NAVY = HexColor('#004D70')
BLUE = HexColor('#0D8FCB')
SKY = HexColor('#EAF7FC')
LIME = HexColor('#B6FF3C')
PINK = HexColor('#FCEBF2')
GOLD = HexColor('#FFC24B')
INK = HexColor('#102C3C')
MUTED = HexColor('#526C7B')
LINE = HexColor('#C9DCE5')
WHITE = colors.white

PAGE_W, PAGE_H = A4

def P(text, style):
    return Paragraph(text, style)

def styles():
    base = getSampleStyleSheet()
    return {
        'cover_kicker': ParagraphStyle('cover_kicker', parent=base['Normal'], fontName='Helvetica-Bold', fontSize=9, leading=12, textColor=BLUE, spaceAfter=5),
        'cover_title': ParagraphStyle('cover_title', parent=base['Normal'], fontName='Helvetica-Bold', fontSize=29, leading=32, textColor=NAVY, spaceAfter=10),
        'subtitle': ParagraphStyle('subtitle', parent=base['Normal'], fontName='Helvetica', fontSize=11, leading=15, textColor=INK),
        'eyebrow': ParagraphStyle('eyebrow', parent=base['Normal'], fontName='Helvetica-Bold', fontSize=8, leading=10, textColor=BLUE, spaceAfter=4),
        'h1': ParagraphStyle('h1', parent=base['Normal'], fontName='Helvetica-Bold', fontSize=22, leading=25, textColor=NAVY, spaceAfter=7),
        'h2': ParagraphStyle('h2', parent=base['Normal'], fontName='Helvetica-Bold', fontSize=14, leading=17, textColor=NAVY, spaceBefore=5, spaceAfter=5),
        'body': ParagraphStyle('body', parent=base['Normal'], fontName='Helvetica', fontSize=9.3, leading=13, textColor=INK, spaceAfter=5),
        'body_small': ParagraphStyle('body_small', parent=base['Normal'], fontName='Helvetica', fontSize=8.3, leading=11.5, textColor=INK, spaceAfter=3),
        'note': ParagraphStyle('note', parent=base['Normal'], fontName='Helvetica', fontSize=8.4, leading=11, textColor=MUTED),
        'card_title': ParagraphStyle('card_title', parent=base['Normal'], fontName='Helvetica-Bold', fontSize=11, leading=13, textColor=NAVY, spaceAfter=4),
        'card_body': ParagraphStyle('card_body', parent=base['Normal'], fontName='Helvetica', fontSize=8.25, leading=11.25, textColor=INK),
        'center_stat': ParagraphStyle('center_stat', parent=base['Normal'], fontName='Helvetica-Bold', fontSize=18, leading=20, textColor=NAVY, alignment=TA_CENTER),
        'center_label': ParagraphStyle('center_label', parent=base['Normal'], fontName='Helvetica', fontSize=8.5, leading=11, textColor=INK, alignment=TA_CENTER),
        'center': ParagraphStyle('center', parent=base['Normal'], fontName='Helvetica', fontSize=10, leading=13, textColor=INK, alignment=TA_CENTER),
        'oath': ParagraphStyle('oath', parent=base['Normal'], fontName='Helvetica', fontSize=12, leading=18, textColor=INK, alignment=TA_CENTER, spaceAfter=8),
    }

S = styles()

def header(canvas, doc, label='PLAYER GUIDE'):
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.rect(0, PAGE_H - 18*mm, PAGE_W, 18*mm, stroke=0, fill=1)
    if LOGO.exists():
        canvas.drawImage(str(LOGO), 18*mm, PAGE_H - 14*mm, width=22*mm, height=10*mm, preserveAspectRatio=True, mask='auto')
    canvas.setFillColor(WHITE)
    canvas.setFont('Helvetica-Bold', 8)
    canvas.drawString(45*mm, PAGE_H - 10.5*mm, 'OCPC x RALLY REBELS | FRIENDLY DUAL MEET')
    canvas.setFont('Helvetica', 7.5)
    canvas.drawRightString(PAGE_W - 18*mm, PAGE_H - 10.5*mm, 'SEPTEMBER 19, 2026')
    canvas.setStrokeColor(LINE)
    canvas.line(18*mm, 14*mm, PAGE_W - 18*mm, 14*mm)
    canvas.setFillColor(MUTED)
    canvas.setFont('Helvetica', 7.5)
    canvas.drawString(18*mm, 8.5*mm, 'Rally District PH, Kawit, Cavite')
    canvas.drawRightString(PAGE_W - 18*mm, 8.5*mm, f'Page {doc.page}')
    canvas.restoreState()

def card(title, body, accent=BLUE, width=174*mm, compact=False):
    body_style = S['body_small'] if compact else S['card_body']
    pad = 5 if compact else 8
    t = Table([[P(title, S['card_title'])], [P(body, body_style)]], colWidths=[width], hAlign='LEFT')
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), WHITE), ('BOX', (0,0), (-1,-1), .6, LINE),
        ('LINEBEFORE', (0,0), (0,-1), 4, accent), ('LEFTPADDING',(0,0),(-1,-1),8), ('RIGHTPADDING',(0,0),(-1,-1),8),
        ('TOPPADDING',(0,0),(-1,-1),pad), ('BOTTOMPADDING',(0,0),(-1,-1),pad),
    ]))
    return t

def stat_table(items):
    row1 = [P(value, S['center_stat']) for value, _ in items]
    row2 = [P(label, S['center_label']) for _, label in items]
    t = Table([row1, row2], colWidths=[(174*mm)/len(items)]*len(items))
    t.setStyle(TableStyle([
        ('BACKGROUND',(0,0),(-1,-1),HexColor('#F4F8FA')), ('BOX',(0,0),(-1,-1),.6,LINE),
        ('INNERGRID',(0,0),(-1,-1),.5,LINE), ('TOPPADDING',(0,0),(-1,-1),8), ('BOTTOMPADDING',(0,0),(-1,-1),8),
    ]))
    return t

def qr_code(value, size=52*mm):
    """A print-sharp QR code for a stable public landing page."""
    widget = qr.QrCodeWidget(value)
    bounds = widget.getBounds()
    width = bounds[2] - bounds[0]
    height = bounds[3] - bounds[1]
    drawing = Drawing(size, size, transform=[size / width, 0, 0, size / height, 0, 0])
    drawing.add(widget)
    return drawing

def guide_cover(story):
    if LOGO.exists():
        ocpc_logo = Image(str(LOGO), width=60*mm, height=28*mm, kind='proportional')
        rally_logo = Image(str(RR_LOGO), width=48*mm, height=29*mm, kind='proportional') if RR_LOGO.exists() else P('<b>RALLY<br/>REBELS</b><br/><font size="8">CLUB</font>', S['center'])
        brand = Table([[ocpc_logo, rally_logo]], colWidths=[87*mm,87*mm], rowHeights=[38*mm])
        brand.setStyle(TableStyle([('BACKGROUND',(0,0),(0,0),SKY),('BACKGROUND',(1,0),(1,0),WHITE),('BOX',(0,0),(-1,-1),.8,BLUE),('INNERGRID',(0,0),(-1,-1),.5,LINE),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('ALIGN',(0,0),(-1,-1),'CENTER')]))
        story.append(brand)
    story.append(Spacer(1, 8*mm))
    story.append(P('OCPC x RALLY REBELS CLUB', S['cover_kicker']))
    story.append(P('Friendly Dual Meet<br/>Player Guide', S['cover_title']))
    story.append(P('Everything players need to know before arriving, while waiting, during matches, and through the medal rounds.', S['subtitle']))
    story.append(Spacer(1, 8*mm))
    story.append(stat_table([('SEPT 19', 'Saturday, 2026'), ('9:00 AM', 'Registration starts'), ('10:00 AM', 'Program starts'), ('5 COURTS', 'Rally District PH')]))
    story.append(Spacer(1, 8*mm))
    banner = Table([[P('<b>The simple version</b><br/>Check in early, keep your pair nearby, watch the live court board, report when called, play the posted format, and confirm your score before leaving the court.', S['body'])]], colWidths=[174*mm])
    banner.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),WHITE),('BOX',(0,0),(-1,-1),.7,LINE),('LINEBEFORE',(0,0),(0,-1),4,LIME),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),9)]))
    story.append(banner)

def section(story, eyebrow, title, intro):
    story.append(P(eyebrow, S['eyebrow']))
    story.append(P(title, S['h1']))
    story.append(P(intro, S['subtitle']))
    story.append(Spacer(1, 4*mm))

def player_guide():
    path = OUT / 'OCPC-Rally-Rebels-Player-Guide-2026_v5.pdf'
    doc = SimpleDocTemplate(str(path), pagesize=A4, leftMargin=18*mm, rightMargin=18*mm, topMargin=28*mm, bottomMargin=22*mm)
    story=[]
    guide_cover(story)
    story.append(PageBreak())
    section(story, 'MATCH-DAY FLOW', 'What to do when you arrive', 'Registration opens at 9:00 AM. The program begins at 10:00 AM. Give yourself time to settle in, complete your arrival checks, and stay ready for the live court board.')
    flow = [
        ('1. Go to Player Check-In', 'Tell the desk your full name and club. Staff will find your retained registration.'),
        ('2. Confirm your details', 'Verify your category, partner, and pair slot. Tell staff immediately if anything is incorrect.'),
        ('3. Complete arrival checks', 'Sign the hardcopy waiver if needed. Staff will verify it and take a clear player photo.'),
        ('4. Find your partner', 'Both players should be present, warmed up, and ready together. A pair cannot start with only one player.'),
        ('5. Scan the displayed QR code', 'Open the live standings and your unique player profile. Your profile shows your current standings, next court assignment, and live schedule.'),
        ('6. Report when called', 'Proceed to the assigned court promptly. If a referee is assigned, follow the pre-match setup.'),
    ]
    for title, body in flow:
        story.append(card(title, body, LIME if title.startswith('1') else BLUE))
        story.append(Spacer(1, 3*mm))
    story.append(P('<b>Bring these:</b> Your paddle, court shoes, water, towel, any medicine you may need, and a phone for schedule updates. Wear your assigned club or event shirt if organizers have provided one.', S['body']))
    story.append(PageBreak())
    section(story, 'TOURNAMENT FORMAT', 'How the dual meet works', 'This is a club-versus-club event using a 5-Game Format. OCPC pairs play Rally Rebels pairs only. Partners from the same club do not face each other.')
    data = [[P('<b>Category</b>',S['body_small']),P('<b>OCPC</b>',S['body_small']),P('<b>Rally Rebels</b>',S['body_small']),P('<b>Matches</b>',S['body_small'])],
            ['Novice','6 pairs','6 pairs','30'], ['Low Intermediate','6 pairs','6 pairs','30'], ['High Intermediate','6 pairs','6 pairs','30'], [P('<b>TOTAL</b>',S['body_small']),P('<b>18 pairs</b>',S['body_small']),P('<b>18 pairs</b>',S['body_small']),P('<b>90</b>',S['body_small'])]]
    table=Table(data,colWidths=[55*mm,36*mm,48*mm,35*mm])
    table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),NAVY),('TEXTCOLOR',(0,0),(-1,0),WHITE),('BACKGROUND',(0,-1),(-1,-1),SKY),('GRID',(0,0),(-1,-1),.5,LINE),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7)]))
    story.append(table); story.append(Spacer(1,5*mm))
    story.append(card('Why not everyone plays everyone', 'Each pair is capped at five scheduled opponents. This keeps the event within the available time and prevents an overloaded day.', GOLD)); story.append(Spacer(1,3*mm))
    story.append(card('Balanced categories', 'Every category has six pairs from OCPC and six pairs from Rally Rebels. Each pair plays five of the six possible opponents from the other club.', LIME)); story.append(Spacer(1,3*mm))
    story.append(card('Transparent opponent draw', 'The one opponent each pair does not play is decided through the official draw ceremony. The result is reviewed and locked into the live schedule. It is not based on personal choice.', PINK))
    story.append(PageBreak())
    section(story, 'COURTS AND SCHEDULE', 'How the day moves', 'Five courts run at the same time. The calendar is the live court board: it shows both the planned order and what is actually happening now.')
    story.append(stat_table([('9:00 AM','Registration starts'),('10:00 AM','Program starts'),('90','5-Game Format matches'),('5:00 PM','Target event end')]))
    story.append(Spacer(1, 7*mm))
    story.append(P('Your posted time is a guide', S['h2']))
    story.append(P('Matches use 15-minute schedule slots. A game can finish early or run long, so the next match may move forward or be delayed. Stay close to the playing area when your match is approaching.', S['body']))
    story.append(P('Reading the live court board', S['h2']))
    for item in ['<b>Green</b> means the court is on time or moving well.', '<b>Yellow</b> means the court is approaching its expected time or beginning to run behind.', '<b>Red</b> means the match is near or beyond the 15-minute operational target, or another urgent court status needs attention.', '<b>Warnings</b> prevent a player from being scheduled on two courts at once and flag back-to-back matches where possible.', '<b>Live order wins.</b> Match Control may move, swap, or bump scheduled boxes as court timing changes.']:
        story.append(P('• ' + item, S['body']))
    story.append(Spacer(1,3*mm)); story.append(card('Important', 'Do not leave the venue without telling your club representative or the joint Match Control team. If your pair is missing when called, the schedule for all five courts can be affected.', HexColor('#D9306B')))
    story.append(PageBreak())
    section(story, 'PLAYING RULES', '5-Game Format match rules', 'Every pair is guaranteed five scheduled matches in the 5-Game Format. The referee or score kiosk records the official result. The posted schedule controls the court order, while the final recorded score controls the winner.')
    story.append(card('Scoring', 'Side-out scoring to 11. Only the serving team can score. Win by two, except at 10-10 the next deciding rally ends the match at 11-10.', BLUE)); story.append(Spacer(1,3*mm))
    story.append(card('Operational timing', 'The schedule expects about 15 minutes per match. The timer helps Match Control manage courts. If a match is ended early, the pair with the higher score is recorded as the winner.', GOLD)); story.append(Spacer(1,3*mm))
    story.append(card('Before the first serve', 'The referee or Match Control records which club receives the first choice, then confirms that choice, the opening serve or receive, and the starting court end. No coin toss is used in this event.', LIME)); story.append(Spacer(1,3*mm))
    story.append(P('During play',S['h2']))
    for item in ['Even serving score: serve from the right side. Odd serving score: serve from the left side.', '5-Game Format matches do not allow team timeouts.', 'A medical timeout may last up to five minutes. Technical, referee, or equipment interruptions are handled by officials and Match Control.', 'When an interruption starts, the match timer pauses. It resumes when the interruption is officially ended.', 'Respect the referee’s call. If no referee is assigned, both pairs are responsible for honest score calls and sportsmanlike play.']:
        story.append(P('• '+item,S['body']))
    story.append(P('How to submit the result',S['h2']))
    story.append(P('<b>Officiated match:</b> The referee logs the live score. At the end, players review the final score and both sides confirm and sign on the referee device.<br/><b>Unofficiated match:</b> Both pairs report together to the score kiosk, enter the final score, then both sides sign to confirm it.',S['body']))
    story.append(PageBreak())
    section(story, 'STANDINGS AND MEDALS', 'How pairs qualify', 'Each category keeps separate standings for OCPC and Rally Rebels. The top two from each club advance directly to medal matches.')
    criteria=[('1','NUMBER OF WINS','The pair with more wins ranks higher.'),('2','POINTS FOR','Total points scored by the pair.'),('3','POINTS AGAINST','Fewer points allowed ranks higher.'),('4','POINT DIFFERENTIAL','Points For minus Points Against.')]
    cdata=[]
    for n,title,body in criteria: cdata.append([P(f'<b>{n}</b>',S['center_stat']),P(f'<b>{title}</b><br/>{body}',S['body_small'])])
    ct=Table(cdata,colWidths=[16*mm,158*mm]);ct.setStyle(TableStyle([('GRID',(0,0),(-1,-1),.5,LINE),('BACKGROUND',(0,0),(0,-1),SKY),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7)]));story.append(ct);story.append(Spacer(1,5*mm))
    story.append(card('Direct medal pathway', '<b>OCPC #1 vs Rally Rebels #1:</b> Gold / Silver<br/><b>OCPC #2 vs Rally Rebels #2:</b> Bronze / 4th Place<br/><br/>There are no semifinals. Same-club pairs cannot face each other in the medal round.', LIME));story.append(Spacer(1,3*mm))
    story.append(card('Medal-match scoring', 'Side-out scoring to 15, no match timer, win by two, with the event cap at 19. If play reaches 19-19, one deciding rally determines the winner.', GOLD));story.append(Spacer(1,3*mm))
    story.append(P('<b>Expected post-format order:</b> Bronze matches begin first on Courts 1, 3, and 5. Gold matches follow for all three categories. The optional Dream Breaker is only considered when time remains. The live Match Control board remains the final source if timing changes.',S['body']))
    story.append(PageBreak())
    section(story, 'CLUB CHAMPIONSHIP', 'Every match helps your club', 'Each completed tournament match contributes to the overall club score. The club with the stronger final standing is recognized as Champion Club.')
    story.append(card('Pair standings', 'Used to identify each club’s #1 and #2 pairs in every category for the direct medal matches.', BLUE));story.append(Spacer(1,3*mm))
    story.append(card('Club standings', 'Combines completed wins from all categories and shows the overall club race, point difference, and recent contributors.', LIME));story.append(Spacer(1,3*mm))
    story.append(P('Optional Dream Breaker',S['h2']))
    for item in ['Only activates if joint organizers confirm that enough time remains.', 'Default target is first to 52 using rally scoring. Organizers may adjust the target before play.', 'Every rally gives one point, no matter which club served.', 'After every four rallies, both clubs switch to their next captain-selected players.', 'At the default 52-point target, teams change court ends when a club reaches 26.', 'Dream Breaker points are added to the club championship only if the round is activated.']:
        story.append(P('• '+item,S['body']))
    story.append(card('Club representative responsibility', 'Dream Breaker pairs can be different from regular tournament pairs. Each club representative chooses the rotation, but both clubs must follow their declared sequence once play begins.', PINK))
    story.append(PageBreak())
    section(story, 'QUICK REFERENCE', 'Play ready. Stay informed. Confirm everything.', 'Keep this page handy on match day. The live Match Control board and organizer announcements are always the final source for court assignments and timing.')
    quick=[('BEFORE PLAY','Check in, verify your category and partner, sign the waiver, have your photo taken, warm up, and watch the live board.'),('WHEN CALLED','Go to the assigned court with your partner. Confirm the correct opponent and whether a referee is assigned.'),('5-GAME FORMAT','Every pair is guaranteed five scheduled matches. Side-out to 11. Win by two. At 10-10, the next deciding rally wins 11-10. No team timeouts.'),('AFTER PLAY','Review the final score. Both sides sign on the referee device or score kiosk. Do not leave until accepted.'),('IF SOMETHING IS WRONG','Stop and ask the referee or Match Control. Do not try to correct another court’s device or schedule yourself.'),('SPORTSMANSHIP','Make honest calls, respect opponents and officials, keep the court safe, and represent your club well.')]
    for title,body in quick:
        story.append(card(title,body,BLUE if title not in ['5-GAME FORMAT','SPORTSMANSHIP'] else LIME));story.append(Spacer(1,3*mm))
    story.append(Spacer(1,3*mm));story.append(P('GOOD LUCK. PLAY WELL TOGETHER!',S['cover_title']))
    doc.build(story, onFirstPage=lambda c,d: header(c,d), onLaterPages=lambda c,d: header(c,d))
    return path

def briefing():
    path=OUT/'OCPC-Rally-Rebels-Opening-Briefing-and-Oath-2026_v3.pdf'
    doc=SimpleDocTemplate(str(path),pagesize=A4,leftMargin=18*mm,rightMargin=18*mm,topMargin=28*mm,bottomMargin=22*mm)
    story=[]
    section(story,'OPENING CEREMONY','Player briefing','The essentials before we begin: this is a friendly meet built on competition, camaraderie, and respect.')
    story.append(stat_table([('SEPT 19','Saturday, 2026'),('9:00 AM','Registration starts'),('10:00 AM','Program starts'),('5 COURTS','Rally District PH')]))
    story.append(Spacer(1,6*mm))
    if LOGO.exists():
        rally_logo = Image(str(RR_LOGO), width=45*mm, height=28*mm, kind='proportional') if RR_LOGO.exists() else 'RALLY REBELS'
        brand=Table([[Image(str(LOGO), width=40*mm, height=28*mm, kind='proportional'),rally_logo]],colWidths=[87*mm,87*mm],rowHeights=[40*mm])
        brand.setStyle(TableStyle([('BACKGROUND',(0,0),(0,0),SKY),('BACKGROUND',(1,0),(1,0),WHITE),('BOX',(0,0),(-1,-1),.8,BLUE),('INNERGRID',(0,0),(-1,-1),.5,LINE),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('ALIGN',(0,0),(-1,-1),'CENTER')]))
        story.append(brand)
    story.append(Spacer(1,6*mm));story.append(P('WHAT EVERY PLAYER NEEDS TO KNOW',S['eyebrow']))
    items=[
        ('1. Format','18 OCPC pairs and 18 Rally Rebels pairs compete in Novice, Low Intermediate, and High Intermediate. Pairs play the other club only: 90 5-Game Format matches across 5 courts.',BLUE),
        ('2. Stay with your pair','Registration opens at 9:00 AM. Check in, confirm your category and partner, complete the waiver/photo check, and stay near the playing area.',LIME),
        ('3. 5-Game Format rules','Every pair is guaranteed five scheduled matches. Side-out scoring to 11. Win by two, except at 10-10: the next rally wins 11-10. Each match uses a 15-minute schedule slot. No team timeouts.',GOLD),
        ('4. Court procedure','Your posted time is a target. Go when called, confirm your opponent and referee, and follow the live Match Control board if courts or times move.',NAVY),
        ('5. Score and disputes','Review and confirm every final score before leaving the court. For any dispute or unclear call: automatic re-serve.',HexColor('#D9306B')),
        ('6. Medal matches','After the 5-Game Format: bronze matches are expected first on Courts 1, 3, and 5. Gold matches follow. Medal matches use side-out to 15, win by two, capped at 19.',GOLD),
        ('7. Dream Breaker','Only if time permits. Rally scoring to 52 by default; every rally scores. Clubs rotate after every 4 rallies and change ends at 26. Organizers announce if activated.',HexColor('#D9306B')),
        ('8. Keep it friendly','This is a friendly meet, not a reason to fight over a point. Make honest calls, respect opponents and officials, keep the court safe, and represent both clubs well.',LIME),
    ]
    grid=[]
    for index in range(0,len(items),2): grid.append([card(*items[index], width=82*mm, compact=True),card(*items[index+1], width=82*mm, compact=True)])
    gridtable=Table(grid,colWidths=[85*mm,85*mm],hAlign='LEFT')
    gridtable.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),4),('TOPPADDING',(0,0),(-1,-1),0),('BOTTOMPADDING',(0,0),(-1,-1),4)]))
    story.append(gridtable);story.append(Spacer(1,2*mm));story.append(P('<b>One final reminder:</b> The joint Match Control team and organizer announcements are the final source for court assignments, timing, and operational changes. Play hard, settle disagreements respectfully, and remember: this is a friendly meet.',S['body_small']))
    story.append(PageBreak())
    section(story,'OPENING CEREMONY','Oath of sportsmanship','All players from both clubs recite the oath together. Please raise your right hand and repeat after the host.')
    oath=['I, [State Your Name], solemnly promise to play with honesty, respect, and fairness.','I will respect my opponents, my partner, the officials, and the game of pickleball.','I will make honest calls, follow the rules, and accept every decision with grace.','I will compete with courage and humility, whether I win or lose.','I will encourage my teammates and treat every player as part of this community.','I will help keep the courts safe, welcoming, and enjoyable for everyone.','Beyond competition, we recognize that this dual meet is a celebration of camaraderie, unity, and community.','May every rally strengthen friendships, inspire teamwork, and remind us that the greatest victories are the connections we build together.','With sportsmanship in our hearts and respect in our actions, we proudly take part in this Friendly Dual Meet.','I will play fair, play hard, and honor the spirit of the game. So help me, God.','<b>Let’s play pickleball!</b>']
    for line in oath: story.append(P(line,S['oath']))
    story.append(Spacer(1,5*mm));story.append(card('Next', 'Pre-ceremonial team handshake, then follow the Match Control team for the program flow and live court announcements.', LIME))
    doc.build(story,onFirstPage=lambda c,d: header(c,d,'OPENING CEREMONY'),onLaterPages=lambda c,d: header(c,d,'OPENING CEREMONY'))
    return path

def poster_frame(path, story):
    doc = SimpleDocTemplate(str(path), pagesize=A4, leftMargin=15*mm, rightMargin=15*mm, topMargin=24*mm, bottomMargin=14*mm)
    doc.build(story, onFirstPage=lambda c,d: header(c,d,'MATCHDAY POSTER'))
    return path

def player_rules_poster():
    path = OUT / 'OCPC-Rally-Rebels-5-Game-Format-Player-Poster-2026.pdf'
    story=[]
    story.append(P('OCPC x RALLY REBELS CLUB', S['cover_kicker']))
    story.append(P('Your 5-Game Format<br/>Matchday Guide', S['cover_title']))
    story.append(P('Every pair is guaranteed five scheduled matches. Stay close, watch the live board, and report to court when called.', S['subtitle']))
    story.append(Spacer(1, 6*mm))
    story.append(stat_table([('9:00 AM','Check-in'),('10:00 AM','Program starts'),('5 GAMES','Per pair'),('5 COURTS','Live board')]))
    story.append(Spacer(1,6*mm))
    steps = [
        ('1. CHECK IN', 'Confirm your partner and category. Complete your waiver and player photo.'),
        ('2. STAY READY', 'Your posted time is a guide. Follow the live court board and report promptly when called.'),
        ('3. PLAY', 'Side-out to 11. Win by two. At 10-10, the next rally wins 11-10. No team timeouts.'),
        ('4. CONFIRM', 'Review the final score with your opponents. Both sides sign before leaving the court.'),
    ]
    for title, body in steps:
        story.append(card(title, body, LIME if title.startswith(('1','3')) else BLUE, width=180*mm))
        story.append(Spacer(1,3*mm))
    story.append(Spacer(1,4*mm))
    story.append(card('How to qualify for medals', 'In each club and category: 1. Number of Wins, 2. Points For, 3. Points Against, then 4. Point Differential. #1 pairs play for Gold/Silver; #2 pairs play for Bronze/4th.', GOLD, width=180*mm))
    story.append(Spacer(1,6*mm))
    story.append(P('PLAY HARD. PLAY FAIR. REPRESENT YOUR CLUB WELL.', S['h2']))
    return poster_frame(path, story)

def qr_access_poster():
    path = OUT / 'OCPC-Rally-Rebels-Live-Access-QR-Poster-2026.pdf'
    story=[]
    story.append(P('OCPC x RALLY REBELS CLUB', S['cover_kicker']))
    story.append(P('Follow the Matchday<br/>Live', S['cover_title']))
    story.append(P('Use the live access QR displayed by Match Control for current standings, court calls, medal rounds, and your pair profile.', S['subtitle']))
    story.append(Spacer(1,6*mm))
    qr_block = Table([[qr_code('https://www.onecavitepickleball.club/tournament/player/', 72*mm)]], colWidths=[180*mm], rowHeights=[82*mm])
    qr_block.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),WHITE),('BOX',(0,0),(-1,-1),1.2,NAVY),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('ALIGN',(0,0),(-1,-1),'CENTER')]))
    story.append(qr_block)
    story.append(Spacer(1,5*mm))
    story.append(P('SCAN THE EVENT QR FROM MATCH CONTROL', S['h2']))
    story.append(P('The QR printed by Match Control contains the secure link for this event. It updates live throughout the day. The sample code above opens the player-profile portal; the event QR gives it your tournament access.', S['body']))
    story.append(Spacer(1,4*mm))
    access = [
        ('LIVE STANDINGS', 'See pair and club rankings as scores are confirmed.'),
        ('YOUR PAIR PROFILE', 'See your next match, court assignment, past results, and check-in status.'),
        ('LIVE COURTS', 'See which court is active, who is up next, and matchday notices.'),
    ]
    for title, body in access:
        story.append(card(title, body, BLUE, width=180*mm))
        story.append(Spacer(1,3*mm))
    story.append(Spacer(1,5*mm))
    story.append(P('Keep your phone nearby. Court assignments may move as live matches finish.', S['center']))
    return poster_frame(path, story)

if __name__ == '__main__':
    print(player_guide())
    print(briefing())
    print(player_rules_poster())
    print(qr_access_poster())
