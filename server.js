const axios = require('axios');
const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ======================
// CẤU HÌNH
// ======================
const BASE = "https://aibcr.me";
const LOGIN_URL = `${BASE}/login`;
const LOBBY_URL = `${BASE}/ae/lobby`;
const GETNEWRESULT_URL = `${BASE}/baccarat/getnewresult`;

const USERNAME = process.env.BCR_USER || "Hoang2285";
const PASSWORD = process.env.BCR_PASS || "hoang2010";

// Render filesystem là ephemeral → lưu state vào /tmp (tồn tại trong session)
const STATE_DIR = process.env.RENDER ? '/tmp' : __dirname;
const AML_STATE_FILE   = path.join(STATE_DIR, 'aml_state.json');
const AML_STATE_BACKUP = path.join(STATE_DIR, 'aml_state_backup.json');
const VIP_STATE_FILE   = path.join(STATE_DIR, 'vip_state.json');

const agent = new https.Agent({ rejectUnauthorized: false });
let cookieJar = '';
let baccaratData = [];
let lastUpdate = null;
let loginRetryCount = 0;

// ============================================================
// BCR – ADAPTIVE MULTI-PATTERN LEARNING (AML) [THUẬT TOÁN CŨ]
// ============================================================
const MIN_PATTERN_LEN = 4;
const MAX_PATTERN_LEN = 12;
const DECAY = 0.95;
const BOOST_CORRECT = 1.0;
const PENALTY_WRONG = -1.5;
const DECAY_EVERY = 50;
const RATIO_MIN = 55.0;
const RATIO_MAX = 89.0;
const AML_LEARN_DURATION_MS = 10 * 60 * 1000;
const AML_SAVE_INTERVAL_MS  = 60 * 1000;

// ============================================================
// DANH MỤC CẦU
// ============================================================
const CAU_CATALOG = {
    cau_bet:     { name: 'Cầu bệt (cầu dọc)',           desc: 'Chuỗi liên tiếp cùng 1 cửa từ 4 phiên trở lên.' },
    cau_1_1:     { name: 'Cầu 1-1 (đối xứng)',           desc: 'Xen kẽ B-P-B-P liên tục.' },
    cau_1_2:     { name: 'Cầu 1-2',                      desc: 'Chu kỳ 1B rồi 2P, hoặc ngược lại.' },
    cau_2_1:     { name: 'Cầu 2-1',                      desc: 'Chu kỳ 2B rồi 1P, hoặc ngược lại.' },
    cau_1_3:     { name: 'Cầu 1-3',                      desc: 'Chu kỳ 1B rồi 3P, hoặc ngược lại.' },
    cau_3_1:     { name: 'Cầu 3-1',                      desc: 'Chu kỳ 3B rồi 1P, hoặc ngược lại.' },
    cau_2_2:     { name: 'Cầu 2-2',                      desc: 'Chu kỳ 2B rồi 2P, hoặc ngược lại.' },
    cau_3_3:     { name: 'Cầu 3-3',                      desc: 'Chu kỳ 3B rồi 3P, hoặc ngược lại.' },
    cau_4_4:     { name: 'Cầu 4-4',                      desc: 'Chu kỳ 4B rồi 4P, hoặc ngược lại.' },
    cau_nghieng: { name: 'Cầu nghiêng / cầu chéo',       desc: 'Lệch về 1 cửa nhưng không đều.' },
    cau_rong:    { name: 'Cầu rồng',                     desc: 'Chuỗi rất dài (>=8) cùng 1 cửa.' },
    cau_gay:     { name: 'Cầu gãy',                      desc: 'Cầu đều bỗng đứt quãng.' },
    cau_hon_hop: { name: 'Cầu hỗn hợp / không ổn định', desc: 'Không có quy luật rõ ràng.' },
    cau_dao:     { name: 'Cầu đảo (bẻ hướng)',           desc: 'Cầu bệt bỗng đảo chiều.' },
    cau_soi:     { name: 'Cầu soi (cầu ảo)',             desc: 'Nhà cái tạo ra để dụ người chơi.' },
    cau_bet_xen: { name: 'Cầu bệt xen kẽ',              desc: 'Các đoạn bệt ngắn xen kẽ nhau.' },
    cau_1_1_2:   { name: 'Cầu 1-1-2',                   desc: 'Chu kỳ 1-1-2 lặp lại.' },
    cau_2_1_1:   { name: 'Cầu 2-1-1',                   desc: 'Chu kỳ 2-1-1 lặp lại.' },
    cau_1_2_1:   { name: 'Cầu 1-2-1',                   desc: 'Chu kỳ 1-2-1 lặp lại.' },
    cau_tam_giac:{ name: 'Cầu tam giác',                 desc: 'Mô hình tam giác đối xứng.' },
    cau_zigzag:  { name: 'Cầu zigzag',                   desc: 'Nhảy zic zắc liên tục.' },
    cau_chuoi:   { name: 'Cầu chuỗi (streak)',           desc: 'Chuỗi dài cùng 1 cửa.' },
    cau_doi:     { name: 'Cầu đôi (double)',              desc: 'Mỗi cửa đúng 2 lần rồi đổi.' }
};

// ============================================================
// PATTERN BOOK [THUẬT TOÁN CŨ - GIỮ NGUYÊN 100%]
// ============================================================
class PatternBook {
    constructor() {
        this.book = new Map();
        this.history = [];
        this.lastPrediction = null;
        this.sessionsSinceDecay = 0;
        this.stats = { total: 0, correct: 0, wrong: 0 };
    }
    _newRecord() {
        return { count: 0, predict_B: 0, predict_P: 0, predict_T: 0, wrong_B: 0, wrong_P: 0, wrong_T: 0, weight: 1.0 };
    }
    _get(pat) {
        let rec = this.book.get(pat);
        if (!rec) { rec = this._newRecord(); this.book.set(pat, rec); }
        return rec;
    }
    pushResult(r) {
        if (!['B','P','T'].includes(r)) return;
        this.history.push(r);
        const endIdx = this.history.length;
        for (let L = MIN_PATTERN_LEN; L <= MAX_PATTERN_LEN; L++) {
            if (endIdx - L < 1) break;
            const pat = this.history.slice(endIdx - L - 1, endIdx - 1).join('');
            const rec = this._get(pat);
            rec.count += 1;
            rec['predict_' + r] += 1;
        }
        if (this.lastPrediction && this.lastPrediction.history_len === endIdx - 1) {
            this._settle(this.lastPrediction, r);
            this.lastPrediction = null;
        }
        this.sessionsSinceDecay++;
        if (this.sessionsSinceDecay >= DECAY_EVERY) {
            for (const rec of this.book.values()) rec.weight *= DECAY;
            this.sessionsSinceDecay = 0;
        }
    }
    _settle(last, actual) {
        const ok = (actual === last.pred);
        this.stats.total++;
        if (ok) this.stats.correct++; else this.stats.wrong++;
        for (const entry of last.pattern_set) {
            const rec = this.book.get(entry.pat);
            if (!rec) continue;
            if (ok) rec.weight += BOOST_CORRECT;
            else { rec.weight += PENALTY_WRONG; rec['wrong_' + last.pred] += 1; }
        }
    }
    predict() {
        const H = this.history, n = H.length;
        if (n === 0) {
            this.lastPrediction = { pattern_set: [], pred: 'B', history_len: 0 };
            return { pred: 'B', scores: { B: 0.34, P: 0.33, T: 0.33 }, candidates: 0, confidence: 0.34, source: 'baseline_empty' };
        }
        const candidates = [];
        for (let L = 1; L <= MAX_PATTERN_LEN; L++) {
            if (n < L) break;
            const pat = H.slice(H.length - L).join('');
            const rec = this.book.get(pat);
            if (!rec) continue;
            const total = rec.predict_B + rec.predict_P + rec.predict_T;
            if (total === 0) continue;
            candidates.push({
                pat, L,
                score_B: (rec.predict_B - rec.wrong_B) / total,
                score_P: (rec.predict_P - rec.wrong_P) / total,
                score_T: (rec.predict_T - rec.wrong_T) / total,
                weight: rec.weight
            });
        }
        if (candidates.length === 0) return this._fallbackPredict(H);
        let W_B = 0, W_P = 0, W_T = 0;
        for (const c of candidates) {
            const w = Math.max(0.0001, c.weight);
            W_B += c.score_B * w; W_P += c.score_P * w; W_T += c.score_T * w;
        }
        if (W_B + W_P + W_T < 1e-9) return this._fallbackPredict(H);
        let pred = 'B';
        if (W_P > W_B) pred = 'P';
        if (W_T > Math.max(W_B, W_P)) pred = 'T';
        this.lastPrediction = { pattern_set: candidates, pred, history_len: n };
        const totalW = W_B + W_P + W_T;
        return {
            pred,
            scores: { B: +W_B.toFixed(4), P: +W_P.toFixed(4), T: +W_T.toFixed(4) },
            candidates: candidates.length,
            confidence: +(totalW > 0 ? (pred === 'B' ? W_B : pred === 'P' ? W_P : W_T) / totalW : 0).toFixed(4),
            source: 'pattern_book'
        };
    }
    _fallbackPredict(H) {
        const n = H.length;
        let cntB = 0, cntP = 0, cntT = 0;
        for (const ch of H) { if (ch === 'B') cntB++; else if (ch === 'P') cntP++; else if (ch === 'T') cntT++; }
        const freq = { B: (cntB+1)/(n+3), P: (cntP+1)/(n+3), T: (cntT+1)/(n+3) };
        const recent = H.slice(-10);
        let rB=0, rP=0, rT=0;
        for (const ch of recent) { if (ch==='B') rB++; else if (ch==='P') rP++; else if (ch==='T') rT++; }
        const m = recent.length;
        const rF = { B: (rB+0.5)/(m+1.5), P: (rP+0.5)/(m+1.5), T: (rT+0.5)/(m+1.5) };
        const last = H[n-1];
        const sym = { B: 0, P: 0, T: 0 };
        if (last === 'B') { sym.P = 0.15; sym.B = -0.05; }
        else if (last === 'P') { sym.B = 0.15; sym.P = -0.05; }
        const combined = {
            B: freq.B*0.4 + rF.B*0.4 + sym.B*0.2,
            P: freq.P*0.4 + rF.P*0.4 + sym.P*0.2,
            T: freq.T*0.4 + rF.T*0.4 + sym.T*0.2
        };
        let pred = 'B';
        if (combined.P > combined[pred]) pred = 'P';
        if (combined.T > combined[pred]) pred = 'T';
        const total = combined.B + combined.P + combined.T;
        this.lastPrediction = { pattern_set: [], pred, history_len: n };
        return {
            pred,
            scores: { B: +combined.B.toFixed(4), P: +combined.P.toFixed(4), T: +combined.T.toFixed(4) },
            candidates: 0,
            confidence: +(total > 0 ? combined[pred]/total : 0.34).toFixed(4),
            source: 'fallback_stats'
        };
    }
    toJSON() {
        return { history: this.history, book: Array.from(this.book.entries()), stats: this.stats, sessionsSinceDecay: this.sessionsSinceDecay };
    }
    static fromJSON(obj) {
        const pb = new PatternBook();
        pb.history = obj.history || [];
        pb.stats = obj.stats || { total: 0, correct: 0, wrong: 0 };
        pb.sessionsSinceDecay = obj.sessionsSinceDecay || 0;
        pb.book = new Map(obj.book || []);
        return pb;
    }
}

// ============================================================
// CẦU ANALYZER
// ============================================================
class CauAnalyzer {
    static analyze(history) {
        if (!history || history.length === 0) return { type: 'unknown', label: 'Chưa có dữ liệu', pattern: '' };
        const H = history, n = H.length, last = H[n-1];
        let streak = 1;
        for (let i = n-2; i >= 0; i--) { if (H[i] === last) streak++; else break; }
        if (streak >= 8) return { type: 'cau_rong',  label: CAU_CATALOG.cau_rong.name,  pattern: last.repeat(streak), streak };
        if (streak >= 4) return { type: 'cau_bet',   label: CAU_CATALOG.cau_bet.name,   pattern: last.repeat(streak), streak };
        if (n >= 6) {
            let is11 = true;
            for (let i = n-1; i >= n-6; i--) { if (i > 0 && H[i] === H[i-1]) { is11 = false; break; } }
            if (is11) return { type: 'cau_1_1', label: CAU_CATALOG.cau_1_1.name, pattern: H.slice(-6).join('') };
        }
        if (n >= 8) {
            const seg = H.slice(-8).join('');
            if (seg === 'BBPPBBPP' || seg === 'PPBBPPBB') return { type: 'cau_2_2', label: CAU_CATALOG.cau_2_2.name, pattern: seg };
        }
        if (n >= 12) {
            const seg = H.slice(-12).join('');
            if (seg === 'BBBPPPBBBPPP' || seg === 'PPPBBBPPPBBB') return { type: 'cau_3_3', label: CAU_CATALOG.cau_3_3.name, pattern: seg };
        }
        if (n >= 6) {
            const seg = H.slice(-6).join('');
            if (seg === 'BPPBPP' || seg === 'PBBPBB') return { type: 'cau_1_2', label: CAU_CATALOG.cau_1_2.name, pattern: seg };
            if (seg === 'BBPBBP' || seg === 'PPBPPB') return { type: 'cau_2_1', label: CAU_CATALOG.cau_2_1.name, pattern: seg };
        }
        if (n >= 6) {
            let zig = true;
            for (let i = n-1; i >= n-5; i--) { if (H[i] === H[i-1]) { zig = false; break; } }
            if (zig) return { type: 'cau_zigzag', label: CAU_CATALOG.cau_zigzag.name, pattern: H.slice(-6).join('') };
        }
        if (n >= 6 && streak >= 2) {
            const before = H[n-streak-1];
            if (before && before !== last) {
                let ps = 1;
                for (let i = n-streak-2; i >= 0; i--) { if (H[i] === before) ps++; else break; }
                if (ps >= 3) return { type: 'cau_dao', label: CAU_CATALOG.cau_dao.name, pattern: before.repeat(ps) + last.repeat(streak) };
            }
        }
        const last10 = H.slice(-10);
        const b10 = last10.filter(x => x === 'B').length;
        const p10 = last10.filter(x => x === 'P').length;
        if (last10.length >= 8 && (b10 >= 7 || p10 >= 7)) return { type: 'cau_nghieng', label: CAU_CATALOG.cau_nghieng.name, pattern: last10.join('') };
        if (n >= 6 && streak === 1) {
            const before = H[n-2]; let ps = 1;
            for (let i = n-3; i >= 0; i--) { if (H[i] === before) ps++; else break; }
            if (ps >= 3) return { type: 'cau_gay', label: CAU_CATALOG.cau_gay.name, pattern: before.repeat(ps) + last };
        }
        if (n >= 6) {
            const seg = H.slice(-6).join('');
            if (seg === 'BBPPBB' || seg === 'PPBBPP') return { type: 'cau_doi', label: CAU_CATALOG.cau_doi.name, pattern: seg };
        }
        return { type: 'cau_hon_hop', label: CAU_CATALOG.cau_hon_hop.name, pattern: H.slice(-8).join('') };
    }
    static detectPBPT(history) {
        if (!history || history.length < 5) return { distribution: null, trend: null, symmetry: null };
        const H = history, n = H.length;
        const cnt = { B: 0, P: 0, T: 0 };
        for (const ch of H) if (cnt[ch] !== undefined) cnt[ch]++;
        const dist = { B: cnt.B, P: cnt.P, T: cnt.T, total: n, pct_B: ((cnt.B/n)*100).toFixed(1), pct_P: ((cnt.P/n)*100).toFixed(1), pct_T: ((cnt.T/n)*100).toFixed(1) };
        const third = Math.floor(n/3);
        let trend = 'stable';
        if (third >= 3) {
            const rB = H.slice(-third).filter(x => x==='B').length;
            const oB = H.slice(0,third).filter(x => x==='B').length;
            if (rB - oB >= 2) trend = 'B_up'; else if (oB - rB >= 2) trend = 'P_up';
        }
        let symScore = 0;
        const half = Math.floor(n/2);
        for (let i = 0; i < half; i++) { if (H[i] === H[n-1-i]) symScore++; }
        return { distribution: dist, trend, symmetry: { score: symScore, total: half, ratio: half > 0 ? symScore/half : 0 } };
    }
}

// ============================================================
// AML MANAGER [THUẬT TOÁN CŨ - GIỮ NGUYÊN]
// ============================================================
class AMLManager {
    constructor() { this.books = new Map(); this.learningStartTime = null; this.lastSaveTime = null; }
    sync(tableName, resultString) {
        if (!resultString) return;
        let entry = this.books.get(tableName);
        if (!entry) {
            entry = { book: new PatternBook(), lastKnownResult: '' };
            this.books.set(tableName, entry);
            for (const ch of resultString) entry.book.pushResult(ch);
            entry.lastKnownResult = resultString;
            entry.book.predict(); return;
        }
        const prev = entry.lastKnownResult;
        if (resultString.length > prev.length) {
            if (resultString.startsWith(prev)) {
                for (const ch of resultString.slice(prev.length)) entry.book.pushResult(ch);
            } else {
                entry.book = new PatternBook();
                for (const ch of resultString) entry.book.pushResult(ch);
            }
            entry.lastKnownResult = resultString;
            entry.book.predict();
        } else if (resultString.length < prev.length) {
            entry.book = new PatternBook();
            for (const ch of resultString) entry.book.pushResult(ch);
            entry.lastKnownResult = resultString;
            entry.book.predict();
        }
    }
    getPrediction(tableName) {
        const entry = this.books.get(tableName);
        if (!entry) return null;
        const book = entry.book, H = book.history, n = H.length;
        const p = book.predict(), pred = p.pred || 'B';
        const W_sum = p.scores.B + p.scores.P + p.scores.T;
        const ratioByWeight = W_sum > 0 ? p.scores[pred] / W_sum : 0.34;
        let totalSamples = 0, correctSamples = 0;
        const patternSet = (book.lastPrediction && book.lastPrediction.pattern_set) || [];
        for (const c of patternSet) {
            const rec = book.book.get(c.pat);
            if (!rec) continue;
            totalSamples += rec.count;
            correctSamples += Math.max(0, rec['predict_'+pred] - (rec['wrong_'+pred] || 0));
        }
        const ratioBySamples = totalSamples > 0 ? correctSamples/totalSamples : ratioByWeight;
        let finalRatio = totalSamples >= 10 ? ratioByWeight*0.4 + ratioBySamples*0.6
                       : totalSamples >=  3 ? ratioByWeight*0.7 + ratioBySamples*0.3
                       : ratioByWeight;
        let percent = finalRatio * 100;
        if (percent < RATIO_MIN) percent = RATIO_MIN + (percent/100)*5;
        if (percent > RATIO_MAX) percent = RATIO_MAX;
        let cau = patternSet.length > 0 ? [...patternSet].sort((a,b)=>b.L-a.L)[0].pat : H.slice(-MAX_PATTERN_LEN).join('');
        if (!cau && n === 0) cau = '—';
        const cauInfo = CauAnalyzer.analyze(H);
        const pbpt = CauAnalyzer.detectPBPT(H);
        return { "bàn": tableName, "phiên": n, "cầu": cau, "loại_cầu": cauInfo.label, "cầu_pattern": cauInfo.pattern, "dự đoán": pred, "tỉ lệ": percent.toFixed(1)+'%', "phân_bố": pbpt.distribution, "xu_hướng": pbpt.trend, "đối_xứng": pbpt.symmetry };
    }
    getAllPredictions() {
        const out = [];
        for (const [t] of this.books) { const p = this.getPrediction(t); if (p) out.push(p); }
        return out;
    }
    saveToFile() {
        try {
            const dump = { savedAt: new Date().toISOString(), learningStartTime: this.learningStartTime, books: {} };
            for (const [t, e] of this.books) dump.books[t] = { book: e.book.toJSON(), lastKnownResult: e.lastKnownResult };
            try { if (fs.existsSync(AML_STATE_FILE)) fs.copyFileSync(AML_STATE_FILE, AML_STATE_BACKUP); } catch(e){}
            fs.writeFileSync(AML_STATE_FILE, JSON.stringify(dump));
            this.lastSaveTime = new Date();
            console.log(`[AML] Saved ${Object.keys(dump.books).length} tables`);
        } catch(err) { console.error('[AML] Save error:', err.message); }
    }
    loadFromFile() {
        const tryLoad = (file) => { try { return JSON.parse(fs.readFileSync(file,'utf8')); } catch(e) { return null; } };
        let dump = fs.existsSync(AML_STATE_FILE) ? tryLoad(AML_STATE_FILE) : null;
        if (!dump && fs.existsSync(AML_STATE_BACKUP)) dump = tryLoad(AML_STATE_BACKUP);
        if (!dump) return false;
        this.learningStartTime = dump.learningStartTime || new Date().toISOString();
        for (const [t, obj] of Object.entries(dump.books || {})) {
            this.books.set(t, { book: PatternBook.fromJSON(obj.book), lastKnownResult: obj.lastKnownResult || '' });
        }
        console.log(`[AML] Restored ${this.books.size} tables`);
        return true;
    }
    isLearningPhase() {
        if (!this.learningStartTime) return false;
        return Date.now() - new Date(this.learningStartTime).getTime() < AML_LEARN_DURATION_MS;
    }
    startLearning() {
        if (!this.learningStartTime) {
            this.learningStartTime = new Date().toISOString();
            console.log(`[AML] Learning started at ${this.learningStartTime}`);
        }
    }
}

// ============================================================
// THUẬT TOÁN VIP MỚI – MARKOV CHAIN BẬC CAO + ENTROPY BALANCE
// ============================================================
class VIPPredictor {
    constructor() {
        this.markov = { 1: new Map(), 2: new Map(), 3: new Map(), 4: new Map(), 5: new Map() };
        this.history = [];
        this.predHistory = [];
    }
    _inc(order, key, outcome) {
        const m = this.markov[order];
        if (!m.has(key)) m.set(key, { B: 0, P: 0, T: 0 });
        const rec = m.get(key);
        if (rec[outcome] !== undefined) rec[outcome]++;
    }
    pushResult(r) {
        if (!['B','P','T'].includes(r)) return;
        const H = this.history, n = H.length;
        for (let o = 1; o <= 5; o++) {
            if (n >= o) this._inc(o, H.slice(n-o).join(''), r);
        }
        this.history.push(r);
    }
    _entropy(dist) {
        const total = dist.B + dist.P + dist.T;
        if (total === 0) return 1.0;
        let H = 0;
        for (const k of ['B','P','T']) { const p = dist[k]/total; if (p > 0) H -= p * Math.log2(p); }
        return H / Math.log2(3);
    }
    _markovScore(order) {
        const H = this.history, n = H.length;
        if (n < order) return null;
        const rec = this.markov[order].get(H.slice(n-order).join(''));
        if (!rec) return null;
        const total = rec.B + rec.P + rec.T;
        if (total < 2) return null;
        return { B: rec.B/total, P: rec.P/total, T: rec.T/total, total, entropy: this._entropy(rec) };
    }
    _momentum() {
        const H = this.history, n = H.length;
        const w = Math.min(10, n);
        if (w < 3) return null;
        const recent = H.slice(n-w);
        const cnt = { B: 0, P: 0, T: 0 };
        recent.forEach(r => cnt[r]++);
        return { B: cnt.B/w, P: cnt.P/w, T: cnt.T/w };
    }
    _antiBias() {
        const ph = this.predHistory;
        if (ph.length < 20) return { B: 0, P: 0, T: 0 };
        const recent = ph.slice(-50);
        const cnt = { B: 0, P: 0, T: 0 };
        recent.forEach(e => { if (cnt[e.pred] !== undefined) cnt[e.pred]++; });
        const n = recent.length;
        const corr = { B: 0, P: 0, T: 0 };
        if (cnt.B/n - 0.45 > 0.15) corr.B = -0.08;
        if (cnt.P/n - 0.45 > 0.15) corr.P = -0.08;
        return corr;
    }
    predict() {
        const H = this.history, n = H.length;
        if (n < 3) {
            return { pred: 'B', prob: { B: 0.45, P: 0.45, T: 0.10 }, confidence: 0.45, pct: '55.0%', source: 'insufficient_data', note: 'Cần thêm dữ liệu' };
        }
        const mW = { 1: 0.10, 2: 0.15, 3: 0.20, 4: 0.25, 5: 0.30 };
        let totalW = 0;
        const ms = { B: 0, P: 0, T: 0 };
        for (let o = 1; o <= 5; o++) {
            const sc = this._markovScore(o);
            if (!sc) continue;
            const ep = sc.entropy > 0.9 ? 0.3 : sc.entropy > 0.7 ? 0.6 : 1.0;
            const sb = sc.total >= 10 ? 1.0 : sc.total >= 5 ? 0.7 : 0.4;
            const w = mW[o] * ep * sb;
            ms.B += sc.B * w; ms.P += sc.P * w; ms.T += sc.T * w;
            totalW += w;
        }
        if (totalW > 0) { ms.B /= totalW; ms.P /= totalW; ms.T /= totalW; }
        else {
            const cnt = { B: 0, P: 0, T: 0 };
            H.forEach(r => cnt[r]++);
            ms.B = cnt.B/n; ms.P = cnt.P/n; ms.T = cnt.T/n;
        }
        const mom = this._momentum() || { B: 0.45, P: 0.45, T: 0.10 };
        const bias = this._antiBias();
        const combined = {
            B: Math.max(0, ms.B*0.65 + mom.B*0.35 + bias.B),
            P: Math.max(0, ms.P*0.65 + mom.P*0.35 + bias.P),
            T: Math.max(0, ms.T*0.65 + mom.T*0.35 + bias.T)
        };
        const sumC = combined.B + combined.P + combined.T;
        if (sumC > 0) { combined.B /= sumC; combined.P /= sumC; combined.T /= sumC; }
        let pred = 'B';
        if (combined.P > combined[pred]) pred = 'P';
        if (combined.T > combined[pred]) pred = 'T';
        const sorted = [combined.B, combined.P, combined.T].sort((a,b) => b-a);
        const margin = sorted[0] - sorted[1];
        const conf = combined[pred];
        const pct = Math.max(55, Math.min(85, 55 + conf * 30)).toFixed(1) + '%';
        this.predHistory.push({ pred, ts: Date.now() });
        if (this.predHistory.length > 200) this.predHistory.shift();
        return {
            pred,
            prob: { B: +combined.B.toFixed(4), P: +combined.P.toFixed(4), T: +combined.T.toFixed(4) },
            confidence: +conf.toFixed(4),
            margin: +margin.toFixed(4),
            pct,
            source: totalW > 0 ? 'markov_momentum' : 'frequency_fallback',
            phien: n
        };
    }
    toJSON() {
        return {
            history: this.history,
            markov: Object.fromEntries(Object.entries(this.markov).map(([k,v]) => [k, Array.from(v.entries())])),
            predHistory: this.predHistory
        };
    }
    static fromJSON(obj) {
        const vp = new VIPPredictor();
        vp.history = obj.history || [];
        vp.predHistory = obj.predHistory || [];
        for (const [k, entries] of Object.entries(obj.markov || {})) vp.markov[parseInt(k)] = new Map(entries);
        return vp;
    }
}

// ============================================================
// VIP MANAGER
// ============================================================
class VIPManager {
    constructor() { this.predictors = new Map(); }
    sync(tableName, resultString) {
        if (!resultString) return;
        let entry = this.predictors.get(tableName);
        if (!entry) { entry = { predictor: new VIPPredictor(), lastKnownResult: '' }; this.predictors.set(tableName, entry); }
        const prev = entry.lastKnownResult;
        if (resultString === prev) return;
        if (resultString.length > prev.length && resultString.startsWith(prev)) {
            for (const ch of resultString.slice(prev.length)) entry.predictor.pushResult(ch);
        } else {
            entry.predictor = new VIPPredictor();
            for (const ch of resultString) entry.predictor.pushResult(ch);
        }
        entry.lastKnownResult = resultString;
    }
    getPrediction(tableName) {
        const entry = this.predictors.get(tableName);
        if (!entry) return null;
        const p = entry.predictor.predict();
        const H = entry.predictor.history;
        const cauInfo = CauAnalyzer.analyze(H);
        const pbpt = CauAnalyzer.detectPBPT(H);
        return {
            "bàn": tableName, "phiên": H.length,
            "loại_cầu": cauInfo.label, "cầu_pattern": cauInfo.pattern,
            "dự đoán": p.pred, "tỉ lệ": p.pct,
            "xác_suất": p.prob, "độ_tin_cậy": p.confidence,
            "biên_độ": p.margin, "nguồn": p.source,
            "phân_bố": pbpt.distribution, "xu_hướng": pbpt.trend,
            "note": p.note || null
        };
    }
    getAllPredictions() {
        const out = [];
        for (const [t] of this.predictors) { const p = this.getPrediction(t); if (p) out.push(p); }
        return out;
    }
    saveToFile() {
        try {
            const dump = { savedAt: new Date().toISOString(), predictors: {} };
            for (const [t, e] of this.predictors) dump.predictors[t] = { predictor: e.predictor.toJSON(), lastKnownResult: e.lastKnownResult };
            fs.writeFileSync(VIP_STATE_FILE, JSON.stringify(dump));
            console.log(`[VIP] Saved ${Object.keys(dump.predictors).length} tables`);
        } catch(err) { console.error('[VIP] Save error:', err.message); }
    }
    loadFromFile() {
        try {
            if (!fs.existsSync(VIP_STATE_FILE)) return false;
            const dump = JSON.parse(fs.readFileSync(VIP_STATE_FILE,'utf8'));
            for (const [t, obj] of Object.entries(dump.predictors || {})) {
                this.predictors.set(t, { predictor: VIPPredictor.fromJSON(obj.predictor), lastKnownResult: obj.lastKnownResult || '' });
            }
            console.log(`[VIP] Restored ${this.predictors.size} tables`);
            return true;
        } catch(err) { console.error('[VIP] Load error:', err.message); return false; }
    }
}

// ======================
// KHỞI TẠO MANAGERS
// ======================
const aml = new AMLManager();
const vip = new VIPManager();

function syncAllFromData() {
    for (const item of baccaratData) {
        if (item.table && item.result) {
            aml.sync(item.table, item.result);
            vip.sync(item.table, item.result);
        }
    }
}

// ======================
// SESSION AXIOS
// ======================
const session = axios.create({
    baseURL: BASE,
    timeout: 30000,
    httpsAgent: agent,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
    }
});
session.interceptors.request.use(config => { if (cookieJar) config.headers.Cookie = cookieJar; return config; });
session.interceptors.response.use(res => {
    const setCookie = res.headers['set-cookie'];
    if (setCookie) {
        for (const cookie of setCookie) {
            const [name, value] = cookie.split(';')[0].split('=');
            if (cookieJar.includes(`${name}=`)) cookieJar = cookieJar.replace(new RegExp(`${name}=[^;]+;?`), '');
            cookieJar += `${name}=${value}; `;
        }
    }
    return res;
});

function getCsrfToken(html) {
    const match = html.match(/<meta\s+name="csrf-token"\s+content="([^"]+)"/);
    return match ? match[1] : null;
}

async function login() {
    try {
        const getResp = await session.get(LOGIN_URL);
        const token = getCsrfToken(getResp.data);
        const formData = new URLSearchParams();
        formData.append('username', USERNAME);
        formData.append('password', PASSWORD);
        formData.append('_token', token);
        formData.append('action', 'Login');
        const resp = await session.post(LOGIN_URL, formData.toString(), {
            headers: { 'Referer': LOGIN_URL, 'Origin': BASE, 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        return resp.status === 200;
    } catch(err) { console.error('Login error:', err.message); return false; }
}

async function goToLobby() {
    try { await session.get(LOBBY_URL); return true; }
    catch(err) { console.error('Lobby error:', err.message); return false; }
}

async function fetchBaccaratData() {
    try {
        let xsrfToken = '';
        const xm = cookieJar.match(/XSRF-TOKEN=([^;]+)/);
        if (xm) xsrfToken = decodeURIComponent(xm[1]);
        const formData = new URLSearchParams();
        formData.append('gameCode', 'ae');
        const resp = await session.post(GETNEWRESULT_URL, formData.toString(), {
            headers: {
                'Referer': LOBBY_URL, 'Origin': BASE,
                'X-Requested-With': 'XMLHttpRequest',
                'X-XSRF-TOKEN': xsrfToken,
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
            }
        });
        if (resp.data && resp.data.data) {
            baccaratData = resp.data.data.map(item => {
                let resultStr = item.result;
                if (Array.isArray(resultStr)) resultStr = resultStr.map(r => (r && r.result) ? r.result : String(r)).join('');
                return { table: item.table_name, result: resultStr || '', shoeId: item.shoeId || '', round: item.round || '' };
            });
            lastUpdate = new Date().toISOString();
            syncAllFromData();
            loginRetryCount = 0;
        }
        return baccaratData;
    } catch(err) {
        console.error('Fetch error:', err.message);
        loginRetryCount++;
        if (loginRetryCount >= 3) {
            console.log('[AUTO] Re-login do session hết hạn...');
            cookieJar = '';
            await login();
            await goToLobby();
            loginRetryCount = 0;
        }
        return [];
    }
}

async function autoUpdate() {
    while (true) {
        await fetchBaccaratData();
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
}

// ======================
// SELF PING – CHỐNG RENDER NGỦ ĐÔNG
// ======================
function startSelfPing(port) {
    const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`;
    setInterval(async () => {
        try {
            const http = require('http');
            const url = new URL('/health', SELF_URL);
            http.get(url.href, (res) => {
                console.log(`[PING] Self-ping ${res.statusCode} OK`);
            }).on('error', () => {});
        } catch(e) {}
    }, 10 * 60 * 1000);
    console.log(`[PING] Self-ping bắt đầu → ${SELF_URL}/health`);
}

// ======================
// EXPRESS
// ======================
const app = express();
app.use(express.json());

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), lastUpdate, tables: baccaratData.length });
});

app.get('/', (req, res) => {
    res.json({
        name: 'Baccarat API Server',
        version: '2.0',
        status: 'running',
        uptime: Math.floor(process.uptime()) + 's',
        lastUpdate,
        tables: baccaratData.length,
        algorithms: {
            standard: 'BCR-AML (Pattern Book)',
            vip: 'VIP-Markov-Entropy v1.0'
        },
        endpoints: {
            standard: ['/api/baccarat', '/api/baccarat/:table', '/api/latest', '/api/predict', '/api/predict/:table', '/api/cau-catalog', '/api/aml-status'],
            vip:      ['/api/vip-predict', '/api/vip-predict/:table', '/api/vip-status'],
            system:   ['/health']
        }
    });
});

app.get('/api/baccarat', (req, res) => {
    res.json({ success: true, data: baccaratData, lastUpdate, total: baccaratData.length });
});
app.get('/api/baccarat/:table', (req, res) => {
    const found = baccaratData.find(i => i.table === req.params.table);
    found ? res.json({ success: true, data: found }) : res.json({ success: false, message: 'Không tìm thấy: ' + req.params.table });
});
app.get('/api/latest', (req, res) => {
    const latest = [...baccaratData].sort((a,b) => (parseInt(b.table)||0) - (parseInt(a.table)||0));
    res.json({ success: true, data: latest.slice(0,10), lastUpdate });
});
app.get('/api/predict', (req, res) => {
    const all = aml.getAllPredictions();
    res.json({ success: true, total: all.length, data: all, learning: aml.isLearningPhase(), lastUpdate });
});
app.get('/api/predict/:table', (req, res) => {
    const p = aml.getPrediction(req.params.table);
    p ? res.json({ success: true, data: p, lastUpdate }) : res.json({ success: false, message: 'Chưa có dữ liệu: ' + req.params.table });
});
app.get('/api/cau-catalog', (req, res) => {
    res.json({ success: true, catalog: CAU_CATALOG });
});
app.get('/api/aml-status', (req, res) => {
    res.json({ success: true, learningStartTime: aml.learningStartTime, isLearning: aml.isLearningPhase(), lastSaveTime: aml.lastSaveTime, totalBooks: aml.books.size, tables: Array.from(aml.books.keys()).slice(0,100) });
});

app.get('/api/vip-predict', (req, res) => {
    const all = vip.getAllPredictions();
    res.json({ success: true, algorithm: 'VIP-Markov-Entropy v1.0', total: all.length, data: all, lastUpdate });
});
app.get('/api/vip-predict/:table', (req, res) => {
    const p = vip.getPrediction(req.params.table);
    p ? res.json({ success: true, algorithm: 'VIP-Markov-Entropy v1.0', data: p, lastUpdate })
      : res.json({ success: false, message: 'VIP chưa có dữ liệu: ' + req.params.table });
});
app.get('/api/vip-status', (req, res) => {
    res.json({ success: true, algorithm: 'VIP-Markov-Entropy v1.0', totalTables: vip.predictors.size, tables: Array.from(vip.predictors.keys()).slice(0,100), lastUpdate });
});

// ======================
// KHỞI ĐỘNG
// ======================
async function start() {
    console.log('==========================================');
    console.log(' BACCARAT API  v2.0  |  AML + VIP');
    console.log('==========================================');
    console.log('ENV:', process.env.RENDER ? 'Render Cloud' : 'Local');

    aml.loadFromFile();
    vip.loadFromFile();
    if (!aml.learningStartTime) aml.startLearning();

    console.log('[1] Đang đăng nhập...');
    const ok = await login();
    if (!ok) {
        console.error('[ERROR] Đăng nhập thất bại – thử lại sau 10s...');
        setTimeout(async () => { await login(); await goToLobby(); }, 10000);
    } else {
        console.log('[OK] Đăng nhập thành công');
        await goToLobby();
        await fetchBaccaratData();
        console.log(`[OK] Loaded ${baccaratData.length} tables`);
    }

    setInterval(() => { aml.saveToFile(); vip.saveToFile(); }, AML_SAVE_INTERVAL_MS);
    aml.saveToFile();
    vip.saveToFile();

    autoUpdate();

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 Server: http://localhost:${PORT}`);
        console.log(`   [AML]  /api/predict`);
        console.log(`   [VIP]  /api/vip-predict`);
        console.log(`   [HEALTH] /health`);
        startSelfPing(PORT);
    });
}

start();
