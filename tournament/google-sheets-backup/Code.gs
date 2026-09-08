var BACKUP_CONFIG = {
  projectId: 'ocpc-website-faf5e',
  apiKey: 'AIzaSyBQYKgSchzlmtIGsIhf68e8OYt7Y8kY7Vo',
  eventId: 'ocpc-rally-rebels-dual-meet-2026',
  tabs: {
    control: 'Backup Control',
    schedule: 'LIVE - Schedule',
    registrations: 'LIVE - Registrations',
    pairs: 'LIVE - Pair Setup',
    standings: 'LIVE - Standings',
    medals: 'LIVE - Medal Matches',
    checkins: 'LIVE - Check-ins',
    referees: 'LIVE - Referees'
  }
};

function onOpen() {
  SpreadsheetApp.getUi().createMenu('OCPC Backup')
    .addItem('Set up automatic backup', 'setupBackup')
    .addItem('Sync now', 'syncTournamentBackup')
    .addSeparator()
    .addItem('Start manual failover', 'startManualFailover')
    .addItem('Resume Firebase sync', 'resumeFirebaseSync')
    .addToUi();
}

function setupBackup() {
  var dialog = HtmlService.createHtmlOutputFromFile('Credentials').setWidth(420).setHeight(390);
  SpreadsheetApp.getUi().showModalDialog(dialog, 'Connect Firebase backup');
}

function completeBackupSetup(email, password) {
  var properties = PropertiesService.getScriptProperties();
  properties.setProperties({ FIREBASE_EMAIL: String(email).trim(), FIREBASE_PASSWORD: String(password) }, false);
  try {
    firebaseIdToken_();
    ensureWorkbook_();
    installMinuteTrigger_();
    syncTournamentBackup();
    return 'Backup ready. Firebase will refresh the LIVE tabs approximately every minute.';
  } catch (error) {
    throw new Error(String(error.message || error));
  } finally {
    properties.deleteProperty('FIREBASE_PASSWORD');
  }
}

function syncTournamentBackup() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    ensureWorkbook_();
    if (backupMode_() === 'MANUAL_FAILOVER') {
      refreshManualStandings_();
      updateControlStatus_('MANUAL_FAILOVER', 'Automatic overwrites paused. Scores entered in LIVE - Schedule are preserved.');
      return;
    }
    var token = firebaseIdToken_();
    var base = 'tournamentEvents/' + BACKUP_CONFIG.eventId;
    var eventDocument = firestoreGet_(base, token);
    var state = fromFirestore_(eventDocument.fields.state);
    var liveMatches = firestoreList_(base + '/matches', token);
    var registrations = firestoreList_(base + '/registrations', token);
    var matchesById = {};
    liveMatches.forEach(function(item) { matchesById[item.id] = item.data; });
    var tables = buildTables_(state, matchesById, registrations);
    Object.keys(tables).forEach(function(tabName) { writeTable_(tabName, tables[tabName]); });
    updateControlStatus_('LIVE_SYNC', 'Healthy. Firebase snapshot written successfully.');
  } catch (error) {
    updateControlStatus_(backupMode_(), 'ERROR: ' + String(error.message || error));
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function startManualFailover() {
  var ui = SpreadsheetApp.getUi();
  var answer = ui.alert('Start manual failover?', 'This stops Firebase from overwriting the LIVE tabs. Continue entering scores in columns H and I of LIVE - Schedule.', ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return;
  setBackupMode_('MANUAL_FAILOVER');
  refreshManualStandings_();
}

function resumeFirebaseSync() {
  var ui = SpreadsheetApp.getUi();
  var answer = ui.alert('Resume Firebase sync?', 'Firebase will overwrite manual failover values on the next refresh. Export or copy any offline scores first.', ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return;
  setBackupMode_('LIVE_SYNC');
  syncTournamentBackup();
}

function ensureWorkbook_() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(BACKUP_CONFIG.tabs).forEach(function(key) {
    var name = BACKUP_CONFIG.tabs[key];
    if (!spreadsheet.getSheetByName(name)) spreadsheet.insertSheet(name);
  });
  var control = spreadsheet.getSheetByName(BACKUP_CONFIG.tabs.control);
  if (!control.getRange('A1').getValue()) {
    control.getRange('A1:B7').setValues([
      ['OCPC tournament backup', 'Value'],
      ['Mode', 'LIVE_SYNC'],
      ['Last successful sync', 'Not yet synced'],
      ['Last attempt', 'Not yet run'],
      ['Status', 'Waiting for setup'],
      ['Firebase event', BACKUP_CONFIG.eventId],
      ['Failover instruction', 'Use OCPC Backup > Start manual failover before editing scores.']
    ]);
    control.getRange('B2').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['LIVE_SYNC', 'MANUAL_FAILOVER'], true).setAllowInvalid(false).build());
    control.setFrozenRows(1);
    control.getRange('A1:B1').setBackground('#003F5E').setFontColor('#FFFFFF').setFontWeight('bold');
    control.getRange('A2:A7').setFontWeight('bold');
    control.setColumnWidth(1, 190); control.setColumnWidth(2, 520);
  }
}

function installMinuteTrigger_() {
  ScriptApp.getProjectTriggers().filter(function(trigger) { return trigger.getHandlerFunction() === 'syncTournamentBackup'; }).forEach(ScriptApp.deleteTrigger);
  ScriptApp.newTrigger('syncTournamentBackup').timeBased().everyMinutes(1).create();
}

function backupMode_() {
  var value = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BACKUP_CONFIG.tabs.control).getRange('B2').getDisplayValue();
  return String(value || 'LIVE_SYNC').trim().toUpperCase();
}

function setBackupMode_(mode) {
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BACKUP_CONFIG.tabs.control).getRange('B2').setValue(mode);
  updateControlStatus_(mode, mode === 'LIVE_SYNC' ? 'Firebase synchronization resumed.' : 'Manual scoring mode active.');
}

function updateControlStatus_(mode, status) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BACKUP_CONFIG.tabs.control);
  var now = Utilities.formatDate(new Date(), 'Asia/Manila', 'MMM d, yyyy h:mm:ss a');
  sheet.getRange('B2').setValue(mode);
  if (status.indexOf('Healthy') === 0) sheet.getRange('B3').setValue(now);
  sheet.getRange('B4:B5').setValues([[now], [status]]);
  sheet.getRange('B5').setBackground(status.indexOf('ERROR') === 0 ? '#F8D7DA' : mode === 'MANUAL_FAILOVER' ? '#FFF2CC' : '#E6F6EC');
}

function firebaseIdToken_() {
  var properties = PropertiesService.getScriptProperties();
  var refreshToken = properties.getProperty('FIREBASE_REFRESH_TOKEN');
  if (!refreshToken) {
    var email = properties.getProperty('FIREBASE_EMAIL');
    var password = properties.getProperty('FIREBASE_PASSWORD');
    if (!email || !password) throw new Error('Run OCPC Backup > Set up automatic backup first.');
    var signIn = fetchJson_('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + BACKUP_CONFIG.apiKey, { method: 'post', contentType: 'application/json', payload: JSON.stringify({ email: email, password: password, returnSecureToken: true }) });
    properties.setProperty('FIREBASE_REFRESH_TOKEN', signIn.refreshToken);
    return signIn.idToken;
  }
  var refreshed = fetchJson_('https://securetoken.googleapis.com/v1/token?key=' + BACKUP_CONFIG.apiKey, { method: 'post', contentType: 'application/x-www-form-urlencoded', payload: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(refreshToken) });
  if (refreshed.refresh_token) properties.setProperty('FIREBASE_REFRESH_TOKEN', refreshed.refresh_token);
  return refreshed.id_token;
}

function fetchJson_(url, options) {
  options = options || {};
  options.muteHttpExceptions = true;
  var response = UrlFetchApp.fetch(url, options);
  var body = JSON.parse(response.getContentText() || '{}');
  if (response.getResponseCode() >= 300) throw new Error((body.error && body.error.message) || ('Request failed: ' + response.getResponseCode()));
  return body;
}

function firestoreGet_(path, token) {
  return fetchJson_('https://firestore.googleapis.com/v1/projects/' + BACKUP_CONFIG.projectId + '/databases/(default)/documents/' + path, { headers: { Authorization: 'Bearer ' + token } });
}

function firestoreList_(path, token) {
  var output = [], pageToken = '';
  do {
    var url = 'https://firestore.googleapis.com/v1/projects/' + BACKUP_CONFIG.projectId + '/databases/(default)/documents/' + path + '?pageSize=300' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    var response = fetchJson_(url, { headers: { Authorization: 'Bearer ' + token } });
    (response.documents || []).forEach(function(document) { output.push({ id: document.name.split('/').pop(), data: fromFirestoreMap_(document.fields || {}) }); });
    pageToken = response.nextPageToken || '';
  } while (pageToken);
  return output;
}

function fromFirestoreMap_(fields) {
  var output = {};
  Object.keys(fields || {}).forEach(function(key) { output[key] = fromFirestore_(fields[key]); });
  return output;
}

function fromFirestore_(value) {
  if (!value) return null;
  if (value.mapValue) return fromFirestoreMap_(value.mapValue.fields || {});
  if (value.arrayValue) return (value.arrayValue.values || []).map(fromFirestore_);
  if (value.integerValue !== undefined) return Number(value.integerValue);
  if (value.doubleValue !== undefined) return Number(value.doubleValue);
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.timestampValue !== undefined) return value.timestampValue;
  if (value.nullValue !== undefined) return null;
  return value.stringValue !== undefined ? value.stringValue : '';
}

function pairName_(state, category, code) {
  var pair = (state.pairs || {})[category + '|' + code] || {};
  return [pair.player1, pair.player2].filter(Boolean).join(' / ') || 'Players not assigned';
}

function standingsFor_(state, category, clubId) {
  var prefix = clubId === 'ocpc' ? 'O' : 'R', count = Number((state.pairCounts || {})[category]) || 0;
  var rows = [];
  for (var index = 1; index <= count; index++) {
    var code = prefix + index, played = 0, wins = 0, pointsFor = 0, pointsAgainst = 0;
    (state.matches || []).forEach(function(match) {
      if (match.category !== category || (clubId === 'ocpc' ? match.a !== code : match.b !== code)) return;
      var score = (state.scores || {})[match.id];
      if (!score || score.a === '' || score.b === '' || score.a === undefined || score.b === undefined) return;
      var own = Number(clubId === 'ocpc' ? score.a : score.b), against = Number(clubId === 'ocpc' ? score.b : score.a);
      played++; pointsFor += own; pointsAgainst += against; if (own > against) wins++;
    });
    rows.push({ code: code, names: pairName_(state, category, code), played: played, wins: wins, losses: played - wins, diff: pointsFor - pointsAgainst, pointsFor: pointsFor, pointsAgainst: pointsAgainst });
  }
  return rows.sort(function(a,b) { return b.wins-a.wins || b.diff-a.diff || b.pointsFor-a.pointsFor || a.code.localeCompare(b.code); });
}

function buildTables_(state, matchesById, registrations) {
  var categories = Object.keys(state.pairCounts || {}), schedule = [['Match ID','Planned time','Planned court','Current court','Category','OCPC pair','OCPC players','OCPC score','Rally Rebels score','Rally Rebels pair','Rally Rebels players','Status','Referee']];
  (state.matches || []).forEach(function(match) {
    var score = (state.scores || {})[match.id] || {}, live = (matchesById[match.id] || {}).live || {}, currentCourt = '';
    Object.keys(state.courts || {}).some(function(number) { if (state.courts[number].matchId === match.id) { currentCourt = number; return true; } return false; });
    var complete = score.a !== undefined && score.a !== '' && score.b !== undefined && score.b !== '';
    schedule.push([match.id,match.time || '',match.court || '',currentCourt,match.category,match.a,pairName_(state,match.category,match.a),score.a === undefined ? '' : score.a,score.b === undefined ? '' : score.b,match.b,pairName_(state,match.category,match.b),complete?'Complete':currentCourt?(live.running?'Playing':'On court'):'Queued',(state.refereeAssignments || {})[match.id] || '']);
  });
  var pairs = [['Category','Club','Pair','Player 1','Player 2']], standings = [['Category','Club','Rank','Pair','Players','Played','Wins','Losses','Point diff','Points for','Points against']];
  categories.forEach(function(category) {
    ['O','R'].forEach(function(prefix) { for (var i=1;i<=Number(state.pairCounts[category]);i++) { var code=prefix+i,pair=(state.pairs||{})[category+'|'+code]||{}; pairs.push([category,prefix==='O'?'OCPC':'Rally Rebels',code,pair.player1||'',pair.player2||'']); } });
    ['ocpc','rebels'].forEach(function(club) { standingsFor_(state,category,club).forEach(function(row,index) { standings.push([category,club==='ocpc'?'OCPC':'Rally Rebels',index+1,row.code,row.names,row.played,row.wins,row.losses,row.diff,row.pointsFor,row.pointsAgainst]); }); });
  });
  var registrationRows = [['Registration ID','Status','Category','Club','Pair','Player 1','Player 1 email','Player 1 DUPR','Player 2','Player 2 email','Player 2 DUPR']];
  registrations.forEach(function(item) { var p=item.data.players||[]; registrationRows.push([item.id,item.data.status||'',item.data.category||'',item.data.clubName||'',item.data.pairCode||'',p[0]&&p[0].fullName||'',p[0]&&p[0].email||'',p[0]&&p[0].dupr||'',p[1]&&p[1].fullName||'',p[1]&&p[1].email||'',p[1]&&p[1].dupr||'']); });
  var medals=[['Category','Round','Side A','Side A players','Score A','Score B','Side B','Side B players']];
  categories.forEach(function(category){['sf1','sf2','final','bronze'].forEach(function(round){var match=((state.medals||{})[category]||{})[round]||{};medals.push([category,round.toUpperCase(),match.a||'TBD',match.a?pairName_(state,category,match.a):'',match.scoreA===undefined?'':match.scoreA,match.scoreB===undefined?'':match.scoreB,match.b||'TBD',match.b?pairName_(state,category,match.b):'']);});});
  var checkins=[['Record','Player','Club','Category','Pair','Payment','Shirt size','Waiver signed','Checked in at']];Object.keys(state.checkins||{}).forEach(function(id){var item=state.checkins[id];checkins.push([id,item.name||'',item.clubName||'',item.category||'',item.pair||'',item.payment||'',item.shirtSize||'',item.waiverSigned?'Yes':'No',item.checkedInAt||'']);});
  var referees=[['Match ID','Referee email']];Object.keys(state.refereeAssignments||{}).forEach(function(id){referees.push([id,state.refereeAssignments[id]]);});
  var output={};output[BACKUP_CONFIG.tabs.schedule]=schedule;output[BACKUP_CONFIG.tabs.registrations]=registrationRows;output[BACKUP_CONFIG.tabs.pairs]=pairs;output[BACKUP_CONFIG.tabs.standings]=standings;output[BACKUP_CONFIG.tabs.medals]=medals;output[BACKUP_CONFIG.tabs.checkins]=checkins;output[BACKUP_CONFIG.tabs.referees]=referees;return output;
}

function writeTable_(tabName, values) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tabName);
  sheet.clearContents();
  if (values.length) sheet.getRange(1,1,values.length,values[0].length).setValues(values);
  sheet.setFrozenRows(1);
  sheet.getRange(1,1,1,values[0].length).setBackground('#003F5E').setFontColor('#FFFFFF').setFontWeight('bold').setWrap(true);
  sheet.getDataRange().setVerticalAlignment('middle');
  if (tabName === BACKUP_CONFIG.tabs.schedule) {
    sheet.getRange(2,8,Math.max(1,values.length-1),2).setBackground('#FFF2CC').setNumberFormat('0');
    sheet.setFrozenColumns(2);
  }
  sheet.autoResizeColumns(1,Math.min(values[0].length,13));
}

function refreshManualStandings_() {
  var spreadsheet=SpreadsheetApp.getActiveSpreadsheet(),sheet=spreadsheet.getSheetByName(BACKUP_CONFIG.tabs.schedule),values=sheet.getDataRange().getValues();
  if(values.length<2)return;
  var records={},pairNames={};values.slice(1).forEach(function(row){var category=row[4],a=row[5],b=row[9],sa=row[7],sb=row[8];pairNames[category+'|'+a]=row[6];pairNames[category+'|'+b]=row[10];if(sa===''||sb===''||isNaN(Number(sa))||isNaN(Number(sb)))return;[ ['OCPC',a,Number(sa),Number(sb)],['Rally Rebels',b,Number(sb),Number(sa)] ].forEach(function(entry){var key=category+'|'+entry[0]+'|'+entry[1],item=records[key]||{category:category,club:entry[0],pair:entry[1],played:0,wins:0,pf:0,pa:0};item.played++;item.pf+=entry[2];item.pa+=entry[3];if(entry[2]>entry[3])item.wins++;records[key]=item;});});
  var grouped={};Object.keys(records).forEach(function(key){var item=records[key],group=item.category+'|'+item.club;(grouped[group]||(grouped[group]=[])).push(item);});
  var output=[['Category','Club','Rank','Pair','Players','Played','Wins','Losses','Point diff','Points for','Points against']];Object.keys(grouped).sort().forEach(function(group){grouped[group].sort(function(a,b){return b.wins-a.wins||(b.pf-b.pa)-(a.pf-a.pa)||b.pf-a.pf;}).forEach(function(item,index){output.push([item.category,item.club,index+1,item.pair,pairNames[item.category+'|'+item.pair]||'',item.played,item.wins,item.played-item.wins,item.pf-item.pa,item.pf,item.pa]);});});writeTable_(BACKUP_CONFIG.tabs.standings,output);
}
