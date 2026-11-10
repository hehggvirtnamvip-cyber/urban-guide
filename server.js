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

const USERNAME = "Hoang2285";
const PASSWORD = "hoang2010";

const agent = new https.Agent({ rejectUnauthorized: false });
let cookieJar = '';
let baccaratData = [];
let lastUpdate = null;

// ============================================================
// BCR – ADAPTIVE MULTI-PATTERN LEARNING (AML)
// ============================================================
const MIN_PATTERN_LEN = 4;
const MAX_PATTERN_LEN = 12;
const DECAY = 0.95;
const BOOST_CORRECT = 1.0;
const PENALTY_WRONG = -1.5;
const DECAY_EVERY = 50;

const RATIO_MIN = 55.0;
const RATIO_MAX = 89.0;

const AML_STATE_FILE = path.join(__dirname, 'aml_state.json');
const AML_STATE_BACKUP = path.join(__dirname, 'aml_state_backup.json');
const AML_LEARN_DURATION_MS = 10 * 60 * 1000; // 10 phút
const AML_SAVE_INTERVAL_MS = 30 * 1000; // 30 giây lưu 1 lần

// ============================================================
// DANH MỤC CẦU BACCARAT (FULL)
// ============================================================
const CAU_CATALOG = {
    'cau_bet': { name: 'Cầu bệt (cầu dọc)', desc: 'Chuỗi kết quả liên tiếp cùng 1 cửa (B hoặc P) từ 4 phiên trở lên.' },
    'cau_1_1': { name: 'Cầu 1-1 (cầu ngang, đối xứng)', desc: 'Xen kẽ B-P-B-P hoặc P-B-P-B liên tục.' },
    'cau_1_2': { name: 'Cầu 1-2', desc: 'Chu kỳ 1 B rồi 2 P, hoặc ngược lại.' },
    'cau_2_1': { name: 'Cầu 2-1', desc: 'Chu kỳ 2 B rồi 1 P, hoặc ngược lại.' },
    'cau_1_3': { name: 'Cầu 1-3', desc: 'Chu kỳ 1 B rồi 3 P, hoặc ngược lại.' },
    'cau_3_1': { name: 'Cầu 3-1', desc: 'Chu kỳ 3 B rồi 1 P, hoặc ngược lại.' },
    'cau_2_2': { name: 'Cầu 2-2', desc: 'Chu kỳ 2 B rồi 2 P, hoặc ngược lại.' },
    'cau_3_3': { name: 'Cầu 3-3', desc: 'Chu kỳ 3 B rồi 3 P, hoặc ngược lại.' },
    'cau_4_4': { name: 'Cầu 4-4', desc: 'Chu kỳ 4 B rồi 4 P, hoặc ngược lại.' },
    'cau_nghieng': { name: 'Cầu nghiêng / cầu chéo', desc: 'Xu hướng lệch về 1 cửa trong nhiều phiên liên tiếp nhưng không đều.' },
    'cau_rong': { name: 'Cầu rồng', desc: 'Chuỗi thắng liên tiếp rất dài (>=8 phiên) cùng 1 cửa.' },
    'cau_gay': { name: 'Cầu gãy', desc: 'Cầu đang đều bỗng đứt quãng, xuất hiện cửa ngược lại.' },
    'cau_hon_hop': { name: 'Cầu hỗn hợp / không ổn định', desc: 'Không có quy luật rõ ràng, kết quả nhảy loạn.' },
    'cau_dao': { name: 'Cầu đảo (bẻ hướng)', desc: 'Cầu đang bệt bỗng đảo chiều sang cửa ngược lại.' },
    'cau_soi': { name: 'Cầu soi (cầu ảo, cầu mồi)', desc: 'Cầu do nhà cái tạo ra để dụ người chơi, không bền.' },
    'cau_bet_xen': { name: 'Cầu bệt xen kẽ', desc: 'Các đoạn bệt ngắn xen kẽ nhau.' },
    'cau_1_1_2': { name: 'Cầu 1-1-2', desc: 'Chu kỳ 1-1-2 lặp lại.' },
    'cau_2_1_1': { name: 'Cầu 2-1-1', desc: 'Chu kỳ 2-1-1 lặp lại.' },
    'cau_1_2_1': { name: 'Cầu 1-2-1', desc: 'Chu kỳ 1-2-1 lặp lại.' },
    'cau_tam_giac': { name: 'Cầu tam giác', desc: 'Kết quả tạo thành mô hình tam giác đối xứng.' },
    'cau_zigzag': { name: 'Cầu zigzag', desc: 'Kết quả nhảy zic zắc liên tục.' },
    'cau_chuoi': { name: 'Cầu chuỗi (streak)', desc: 'Chuỗi dài cùng 1 cửa, tương tự cầu bệt.' },
    'cau_doi': { name: 'Cầu đôi (double)', desc: 'Mỗi cửa xuất hiện đúng 2 lần rồi đổi.' }
};

// ============================================================
// PATTERN BOOK
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
        return {
            count: 0,
            predict_B: 0, predict_P: 0, predict_T: 0,
            wrong_B: 0, wrong_P: 0, wrong_T: 0,
            weight: 1.0
        };
    }

    _get(pat) {
        let rec = this.book.get(pat);
        if (!rec) {
            rec = this._newRecord();
            this.book.set(pat, rec);
        }
        return rec;
    }

    pushResult(r) {
        if (!['B', 'P', 'T'].includes(r)) return;

        this.history.push(r);
        const endIdx = this.history.length;

        for (let L = MIN_PATTERN_LEN; L <= MAX_PATTERN_LEN; L++) {
            if (endIdx - L < 1) break;
            const patArr = this.history.slice(endIdx - L - 1, endIdx - 1);
            const pat = patArr.join('');
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
        if (ok) this.stats.correct++;
        else this.stats.wrong++;

        for (const entry of last.pattern_set) {
            const rec = this.book.get(entry.pat);
            if (!rec) continue;
            if (ok) {
                rec.weight += BOOST_CORRECT;
            } else {
                rec.weight += PENALTY_WRONG;
                rec['wrong_' + last.pred] += 1;
            }
        }
    }

    predict() {
        const H = this.history;
        const n = H.length;

        if (n === 0) {
            this.lastPrediction = { pattern_set: [], pred: 'B', history_len: 0 };
            return {
                pred: 'B',
                scores: { B: 0.34, P: 0.33, T: 0.33 },
                candidates: 0,
                confidence: 0.34,
                source: 'baseline_empty'
            };
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
                pat,
                L,
                score_B: (rec.predict_B - rec.wrong_B) / total,
                score_P: (rec.predict_P - rec.wrong_P) / total,
                score_T: (rec.predict_T - rec.wrong_T) / total,
                weight: rec.weight
            });
        }

        if (candidates.length === 0) {
            return this._fallbackPredict(H);
        }

        let W_B = 0, W_P = 0, W_T = 0;
        for (const c of candidates) {
            const w = Math.max(0.0001, c.weight);
            W_B += c.score_B * w;
            W_P += c.score_P * w;
            W_T += c.score_T * w;
        }

        const scores = { B: W_B, P: W_P, T: W_T };

        if (W_B + W_P + W_T < 1e-9) {
            return this._fallbackPredict(H);
        }

        let pred = 'B';
        if (scores.P > scores[pred]) pred = 'P';
        if (scores.T > scores[pred]) pred = 'T';

        this.lastPrediction = {
            pattern_set: candidates,
            pred,
            history_len: n
        };

        const totalW = W_B + W_P + W_T;
        const conf = totalW > 0 ? scores[pred] / totalW : 0;

        return {
            pred,
            scores: {
                B: +W_B.toFixed(4),
                P: +W_P.toFixed(4),
                T: +W_T.toFixed(4)
            },
            candidates: candidates.length,
            confidence: +conf.toFixed(4),
            source: 'pattern_book'
        };
    }

    _fallbackPredict(H) {
        const n = H.length;

        let cntB = 0, cntP = 0, cntT = 0;
        for (const ch of H) {
            if (ch === 'B') cntB++;
            else if (ch === 'P') cntP++;
            else if (ch === 'T') cntT++;
        }
        const freq = {
            B: (cntB + 1) / (n + 3),
            P: (cntP + 1) / (n + 3),
            T: (cntT + 1) / (n + 3)
        };

        const recent = n >= 5 ? H.slice(-10) : H.slice(-n);
        let rB = 0, rP = 0, rT = 0;
        for (const ch of recent) {
            if (ch === 'B') rB++;
            else if (ch === 'P') rP++;
            else if (ch === 'T') rT++;
        }
        const m = recent.length;
        const recentFreq = {
            B: (rB + 0.5) / (m + 1.5),
            P: (rP + 0.5) / (m + 1.5),
            T: (rT + 0.5) / (m + 1.5)
        };

        const last = n > 0 ? H[n - 1] : null;
        const symmetry = { B: 0, P: 0, T: 0 };
        if (last === 'B') { symmetry.P = 0.15; symmetry.B = -0.05; }
        else if (last === 'P') { symmetry.B = 0.15; symmetry.P = -0.05; }

        const combined = {
            B: freq.B * 0.4 + recentFreq.B * 0.4 + symmetry.B * 0.2,
            P: freq.P * 0.4 + recentFreq.P * 0.4 + symmetry.P * 0.2,
            T: freq.T * 0.4 + recentFreq.T * 0.4 + symmetry.T * 0.2
        };

        let pred = 'B';
        if (combined.P > combined[pred]) pred = 'P';
        if (combined.T > combined[pred]) pred = 'T';

        const total = combined.B + combined.P + combined.T;
        const conf = total > 0 ? combined[pred] / total : 0.34;

        this.lastPrediction = { pattern_set: [], pred, history_len: n };

        return {
            pred,
            scores: {
                B: +combined.B.toFixed(4),
                P: +combined.P.toFixed(4),
                T: +combined.T.toFixed(4)
            },
            candidates: 0,
            confidence: +conf.toFixed(4),
            source: 'fallback_stats'
        };
    }

    toJSON() {
        return {
            history: this.history,
            book: Array.from(this.book.entries()),
            stats: this.stats,
            sessionsSinceDecay: this.sessionsSinceDecay
        };
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
// CẦU ANALYZER – PHÂN TÍCH LOẠI CẦU
// ============================================================
class CauAnalyzer {
    static analyze(history) {
        if (!history || history.length === 0) return { type: 'unknown', label: 'Chưa có dữ liệu', pattern: '' };
        const H = history;
        const n = H.length;
        const last = H[n - 1];

        // Cầu bệt: >=4 cùng cửa
        let streak = 1;
        for (let i = n - 2; i >= 0; i--) {
            if (H[i] === last) streak++;
            else break;
        }
        if (streak >= 8) return { type: 'cau_rong', label: CAU_CATALOG.cau_rong.name, pattern: last.repeat(streak), streak };
        if (streak >= 4) return { type: 'cau_bet', label: CAU_CATALOG.cau_bet.name, pattern: last.repeat(streak), streak };

        // Cầu 1-1
        if (n >= 6) {
            let is11 = true;
            for (let i = n - 1; i >= n - 6; i--) {
                if (i > 0 && H[i] === H[i - 1]) { is11 = false; break; }
            }
            if (is11) return { type: 'cau_1_1', label: CAU_CATALOG.cau_1_1.name, pattern: H.slice(-6).join('') };
        }

        // Cầu 2-2
        if (n >= 8) {
            const seg = H.slice(-8).join('');
            if (seg === 'BBPPBBPP' || seg === 'PPBBPPBB') return { type: 'cau_2_2', label: CAU_CATALOG.cau_2_2.name, pattern: seg };
        }

        // Cầu 3-3
        if (n >= 12) {
            const seg = H.slice(-12).join('');
            if (seg === 'BBBPPPBBBPPP' || seg === 'PPPBBBPPPBBB') return { type: 'cau_3_3', label: CAU_CATALOG.cau_3_3.name, pattern: seg };
        }

        // Cầu 1-2 / 2-1
        if (n >= 6) {
            const seg = H.slice(-6).join('');
            if (seg === 'BPPBPP' || seg === 'PBBPBB') return { type: 'cau_1_2', label: CAU_CATALOG.cau_1_2.name, pattern: seg };
            if (seg === 'BBPBBP' || seg === 'PPBPPB') return { type: 'cau_2_1', label: CAU_CATALOG.cau_2_1.name, pattern: seg };
        }

        // Cầu zigzag
        if (n >= 6) {
            let zig = true;
            for (let i = n - 1; i >= n - 5; i--) {
                if (H[i] === H[i - 1]) { zig = false; break; }
            }
            if (zig) return { type: 'cau_zigzag', label: CAU_CATALOG.cau_zigzag.name, pattern: H.slice(-6).join('') };
        }

        // Cầu đảo
        if (n >= 6 && streak >= 2) {
            const before = H[n - streak - 1];
            if (before && before !== last) {
                // trước đó có streak ngược
                let prevStreak = 1;
                for (let i = n - streak - 2; i >= 0; i--) {
                    if (H[i] === before) prevStreak++;
                    else break;
                }
                if (prevStreak >= 3) return { type: 'cau_dao', label: CAU_CATALOG.cau_dao.name, pattern: before.repeat(prevStreak) + last.repeat(streak) };
            }
        }

        // Cầu nghiêng
        const last10 = H.slice(-10);
        const b10 = last10.filter(x => x === 'B').length;
        const p10 = last10.filter(x => x === 'P').length;
        if (last10.length >= 8) {
            if (b10 >= 7) return { type: 'cau_nghieng', label: CAU_CATALOG.cau_nghieng.name, pattern: last10.join('') };
            if (p10 >= 7) return { type: 'cau_nghieng', label: CAU_CATALOG.cau_nghieng.name, pattern: last10.join('') };
        }

        // Cầu gãy: trước đó bệt, giờ đứt
        if (n >= 6 && streak === 1) {
            const before = H[n - 2];
            let prevStreak = 1;
            for (let i = n - 3; i >= 0; i--) {
                if (H[i] === before) prevStreak++;
                else break;
            }
            if (prevStreak >= 3) return { type: 'cau_gay', label: CAU_CATALOG.cau_gay.name, pattern: before.repeat(prevStreak) + last };
        }

        // Cầu đôi
        if (n >= 6) {
            const seg = H.slice(-6).join('');
            if (seg === 'BBPPBB' || seg === 'PPBBPP' || seg === 'BBPPBB') return { type: 'cau_doi', label: CAU_CATALOG.cau_doi.name, pattern: seg };
        }

        // Cầu hỗn hợp
        return { type: 'cau_hon_hop', label: CAU_CATALOG.cau_hon_hop.name, pattern: H.slice(-8).join('') };
    }

    static detectPBPT(history) {
        // Phân bố - Phân tích
        if (!history || history.length < 5) return { distribution: null, trend: null, symmetry: null };
        const H = history;
        const n = H.length;
        const cnt = { B: 0, P: 0, T: 0 };
        for (const ch of H) if (cnt[ch] !== undefined) cnt[ch]++;

        const dist = {
            B: cnt.B, P: cnt.P, T: cnt.T,
            total: n,
            pct_B: ((cnt.B / n) * 100).toFixed(1),
            pct_P: ((cnt.P / n) * 100).toFixed(1),
            pct_T: ((cnt.T / n) * 100).toFixed(1)
        };

        // Trend: so sánh 1/3 gần vs 1/3 xa
        const third = Math.floor(n / 3);
        let trend = 'stable';
        if (third >= 3) {
            const recentB = H.slice(-third).filter(x => x === 'B').length;
            const oldB = H.slice(0, third).filter(x => x === 'B').length;
            if (recentB - oldB >= 2) trend = 'B_up';
            else if (oldB - recentB >= 2) trend = 'P_up';
        }

        // Symmetry: đối xứng
        let symScore = 0;
        const half = Math.floor(n / 2);
        for (let i = 0; i < half; i++) {
            if (H[i] === H[n - 1 - i]) symScore++;
        }
        const symmetry = { score: symScore, total: half, ratio: half > 0 ? (symScore / half) : 0 };

        return { distribution: dist, trend, symmetry };
    }
}

// ============================================================
// AML MANAGER
// ============================================================
class AMLManager {
    constructor() {
        this.books = new Map();
        this.learningStartTime = null;
        this.lastSaveTime = null;
    }

    sync(tableName, resultString) {
        if (!resultString) return;

        let entry = this.books.get(tableName);
        if (!entry) {
            entry = { book: new PatternBook(), lastKnownResult: '' };
            this.books.set(tableName, entry);
            for (const ch of resultString) entry.book.pushResult(ch);
            entry.lastKnownResult = resultString;
            entry.book.predict();
            return;
        }

        const prev = entry.lastKnownResult;
        if (resultString.length > prev.length) {
            if (resultString.startsWith(prev)) {
                const added = resultString.slice(prev.length);
                for (const ch of added) entry.book.pushResult(ch);
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

        const book = entry.book;
        const H = book.history;
        const n = H.length;

        const p = book.predict();
        const pred = p.pred || 'B';

        const W_B = p.scores.B;
        const W_P = p.scores.P;
        const W_T = p.scores.T;
        const W_sum = W_B + W_P + W_T;
        const ratioByWeight = W_sum > 0 ? (p.scores[pred] / W_sum) : 0.34;

        let totalSamples = 0;
        let correctSamples = 0;
        const patternSet = (book.lastPrediction && book.lastPrediction.pattern_set) || [];
        for (const c of patternSet) {
            const rec = book.book.get(c.pat);
            if (!rec) continue;
            totalSamples += rec.count;
            const wrongForPred = rec['wrong_' + pred] || 0;
            correctSamples += Math.max(0, rec['predict_' + pred] - wrongForPred);
        }
        const ratioBySamples = totalSamples > 0 ? (correctSamples / totalSamples) : ratioByWeight;

        let finalRatio;
        if (totalSamples >= 10) {
            finalRatio = ratioByWeight * 0.4 + ratioBySamples * 0.6;
        } else if (totalSamples >= 3) {
            finalRatio = ratioByWeight * 0.7 + ratioBySamples * 0.3;
        } else {
            finalRatio = ratioByWeight;
        }

        let percent = finalRatio * 100;

        if (percent < RATIO_MIN) {
            percent = RATIO_MIN + (percent / 100) * 5;
        }
        if (percent > RATIO_MAX) percent = RATIO_MAX;

        let cau;
        if (patternSet.length > 0) {
            const longest = [...patternSet].sort((a, b) => b.L - a.L)[0];
            cau = longest.pat;
        } else {
            cau = H.slice(-MAX_PATTERN_LEN).join('');
        }
        if (!cau && n === 0) cau = '—';

        const cauInfo = CauAnalyzer.analyze(H);
        const pbpt = CauAnalyzer.detectPBPT(H);

        return {
            "bàn": tableName,
            "phiên": n,
            "cầu": cau,
            "loại_cầu": cauInfo.label,
            "cầu_pattern": cauInfo.pattern,
            "dự đoán": pred,
            "tỉ lệ": percent.toFixed(1) + '%',
            "phân_bố": pbpt.distribution,
            "xu_hướng": pbpt.trend,
            "đối_xứng": pbpt.symmetry
        };
    }

    getAllPredictions() {
        const out = [];
        for (const [tableName] of this.books) {
            const p = this.getPrediction(tableName);
            if (p) out.push(p);
        }
        return out;
    }

    saveToFile() {
        try {
            const dump = {
                savedAt: new Date().toISOString(),
                learningStartTime: this.learningStartTime,
                books: {}
            };
            for (const [t, e] of this.books) {
                dump.books[t] = {
                    book: e.book.toJSON(),
                    lastKnownResult: e.lastKnownResult
                };
            }

            // Ghi backup trước
            try {
                if (fs.existsSync(AML_STATE_FILE)) {
                    fs.copyFileSync(AML_STATE_FILE, AML_STATE_BACKUP);
                }
            } catch (e) {}

            fs.writeFileSync(AML_STATE_FILE, JSON.stringify(dump));
            this.lastSaveTime = new Date();
            console.log(`[AML] Đã lưu state (${Object.keys(dump.books).length} bàn) lúc ${this.lastSaveTime.toISOString()}`);
        } catch (err) {
            console.error('[AML] Lỗi lưu state:', err.message);
        }
    }

    loadFromFile() {
        try {
            if (!fs.existsSync(AML_STATE_FILE)) {
                // thử backup
                if (fs.existsSync(AML_STATE_BACKUP)) {
                    const dump = JSON.parse(fs.readFileSync(AML_STATE_BACKUP, 'utf8'));
                    this._restore(dump);
                    console.log('[AML] Đã khôi phục từ BACKUP');
                    return true;
                }
                return false;
            }
            const dump = JSON.parse(fs.readFileSync(AML_STATE_FILE, 'utf8'));
            this._restore(dump);
            console.log(`[AML] Đã khôi phục state (${this.books.size} bàn)`);
            return true;
        } catch (err) {
            console.error('[AML] Lỗi load state:', err.message);
            // thử backup
            try {
                if (fs.existsSync(AML_STATE_BACKUP)) {
                    const dump = JSON.parse(fs.readFileSync(AML_STATE_BACKUP, 'utf8'));
                    this._restore(dump);
                    console.log('[AML] Đã khôi phục từ BACKUP sau lỗi');
                    return true;
                }
            } catch (e) {}
            return false;
        }
    }

    _restore(dump) {
        this.learningStartTime = dump.learningStartTime || new Date().toISOString();
        const books = dump.books || dump; // backward compat
        for (const [t, obj] of Object.entries(books)) {
            this.books.set(t, {
                book: PatternBook.fromJSON(obj.book),
                lastKnownResult: obj.lastKnownResult || ''
            });
        }
    }

    isLearningPhase() {
        if (!this.learningStartTime) return false;
        const elapsed = Date.now() - new Date(this.learningStartTime).getTime();
        return elapsed < AML_LEARN_DURATION_MS;
    }

    startLearning() {
        if (!this.learningStartTime) {
            this.learningStartTime = new Date().toISOString();
            console.log(`[AML] Bắt đầu học cầu lúc ${this.learningStartTime}`);
        }
    }
}

const aml = new AMLManager();

function syncAMLFromData() {
    for (const item of baccaratData) {
        if (item.table && item.result) {
            aml.sync(item.table, item.result);
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

session.interceptors.request.use(config => {
    if (cookieJar) config.headers.Cookie = cookieJar;
    return config;
});

session.interceptors.response.use(res => {
    const setCookie = res.headers['set-cookie'];
    if (setCookie) {
        for (const cookie of setCookie) {
            const [name, value] = cookie.split(';')[0].split('=');
            if (cookieJar.includes(`${name}=`)) {
                cookieJar = cookieJar.replace(new RegExp(`${name}=[^;]+;?`), '');
            }
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

        const headers = {
            'Referer': LOGIN_URL,
            'Origin': BASE,
            'Content-Type': 'application/x-www-form-urlencoded'
        };

        const loginResp = await session.post(LOGIN_URL, formData.toString(), { headers });
        return loginResp.status === 200;
    } catch (error) {
        console.error('Login error:', error.message);
        return false;
    }
}

async function goToLobby() {
    try {
        await session.get(LOBBY_URL);
        return true;
    } catch (error) {
        console.error('Lobby error:', error.message);
        return false;
    }
}

async function fetchBaccaratData() {
    try {
        let xsrfToken = '';
        const xsrfMatch = cookieJar.match(/XSRF-TOKEN=([^;]+)/);
        if (xsrfMatch) xsrfToken = decodeURIComponent(xsrfMatch[1]);

        const headers = {
            'Referer': LOBBY_URL,
            'Origin': BASE,
            'X-Requested-With': 'XMLHttpRequest',
            'X-XSRF-TOKEN': xsrfToken,
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
        };

        const formData = new URLSearchParams();
        formData.append('gameCode', 'ae');

        const resp = await session.post(GETNEWRESULT_URL, formData.toString(), { headers });

        if (resp.data && resp.data.data) {
            baccaratData = resp.data.data.map(item => {
                let resultStr = item.result;
                if (Array.isArray(resultStr)) {
                    resultStr = resultStr.map(r => (r && r.result) ? r.result : String(r)).join('');
                }
                return {
                    table: item.table_name,
                    result: resultStr || '',
                    shoeId: item.shoeId || '',
                    round: item.round || ''
                };
            });
            lastUpdate = new Date().toISOString();
            syncAMLFromData();
        }

        return baccaratData;
    } catch (error) {
        console.error('Fetch error:', error.message);
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
// EXPRESS
// ======================
const app = express();

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    next();
});

app.get('/', (req, res) => {
    res.json({
        name: 'Baccarat API Server + BCR-AML',
        status: 'running',
        learning: aml.isLearningPhase(),
        learningStartTime: aml.learningStartTime,
        lastSaveTime: aml.lastSaveTime,
        endpoints: [
            '/api/baccarat',
            '/api/baccarat/:table',
            '/api/latest',
            '/api/predict',
            '/api/predict/:table',
            '/api/cau-catalog',
            '/api/aml-status'
        ]
    });
});

app.get('/api/baccarat', (req, res) => {
    res.json({
        success: true,
        data: baccaratData,
        lastUpdate: lastUpdate,
        total: baccaratData.length
    });
});

app.get('/api/baccarat/:table', (req, res) => {
    const tableName = req.params.table;
    const found = baccaratData.find(item => item.table === tableName);
    if (found) {
        res.json({ success: true, data: found });
    } else {
        res.json({ success: false, message: 'Không tìm thấy bàn ' + tableName });
    }
});

app.get('/api/latest', (req, res) => {
    const latest = [...baccaratData].sort((a, b) => {
        const numA = parseInt(a.table) || 0;
        const numB = parseInt(b.table) || 0;
        return numB - numA;
    });
    res.json({ success: true, data: latest.slice(0, 10), lastUpdate: lastUpdate });
});

app.get('/api/predict', (req, res) => {
    const all = aml.getAllPredictions();
    res.json({
        success: true,
        total: all.length,
        data: all,
        learning: aml.isLearningPhase(),
        lastUpdate: lastUpdate
    });
});

app.get('/api/predict/:table', (req, res) => {
    const p = aml.getPrediction(req.params.table);
    if (!p) {
        return res.json({
            success: false,
            message: 'Bàn chưa có dữ liệu: ' + req.params.table
        });
    }
    res.json({ success: true, data: p, lastUpdate: lastUpdate });
});

app.get('/api/cau-catalog', (req, res) => {
    res.json({ success: true, catalog: CAU_CATALOG });
});

app.get('/api/aml-status', (req, res) => {
    res.json({
        success: true,
        learningStartTime: aml.learningStartTime,
        isLearning: aml.isLearningPhase(),
        lastSaveTime: aml.lastSaveTime,
        totalBooks: aml.books.size,
        tables: Array.from(aml.books.keys()).slice(0, 100)
    });
});

// ======================
// KHỞI ĐỘNG
// ======================
async function start() {
    console.log('========================================');
    console.log('BACCARAT API SERVER + BCR-AML FULL');
    console.log('========================================');

    aml.loadFromFile();
    if (!aml.learningStartTime) {
        aml.startLearning();
    }

    console.log('[1] Đang đăng nhập...');
    const loginOk = await login();
    if (!loginOk) {
        console.error('[ERROR] Đăng nhập thất bại!');
    } else {
        console.log('[OK] Đăng nhập thành công');
        console.log('[2] Vào lobby...');
        await goToLobby();
        console.log('[OK] Vào lobby thành công');

        console.log('[3] Lấy dữ liệu lần đầu...');
        await fetchBaccaratData();
        console.log(`[OK] Đã lấy ${baccaratData.length} bàn`);
    }

    // Lưu định kỳ 30s để chống mất dữ liệu khi Render ngủ đông
    setInterval(() => aml.saveToFile(), AML_SAVE_INTERVAL_MS);

    // Lưu ngay khi khởi động để đảm bảo có state
    aml.saveToFile();

    autoUpdate();

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 API SERVER ĐANG CHẠY TRÊN PORT ${PORT}`);
        console.log(`   http://localhost:${PORT}/api/predict`);
        console.log(`   http://localhost:${PORT}/api/aml-status`);
    });
}

start();
