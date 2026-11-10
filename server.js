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
// BCR – ADAPTIVE MULTI-PATTERN LEARNING (AML) — THUẬT TOÁN CŨ
// (GIỮ NGUYÊN 100% – KHÔNG SỬA)
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
const AML_LEARN_DURATION_MS = 10 * 60 * 1000;
const AML_SAVE_INTERVAL_MS = 30 * 1000;

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
// PATTERN BOOK — THUẬT TOÁN CŨ (GIỮ NGUYÊN)
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
// CẦU ANALYZER – PHÂN TÍCH LOẠI CẦU (GIỮ NGUYÊN)
// ============================================================
class CauAnalyzer {
    static analyze(history) {
        if (!history || history.length === 0) return { type: 'unknown', label: 'Chưa có dữ liệu', pattern: '' };
        const H = history;
        const n = H.length;
        const last = H[n - 1];

        let streak = 1;
        for (let i = n - 2; i >= 0; i--) {
            if (H[i] === last) streak++;
            else break;
        }
        if (streak >= 8) return { type: 'cau_rong', label: CAU_CATALOG.cau_rong.name, pattern: last.repeat(streak), streak };
        if (streak >= 4) return { type: 'cau_bet', label: CAU_CATALOG.cau_bet.name, pattern: last.repeat(streak), streak };

        if (n >= 6) {
            let is11 = true;
            for (let i = n - 1; i >= n - 6; i--) {
                if (i > 0 && H[i] === H[i - 1]) { is11 = false; break; }
            }
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
            for (let i = n - 1; i >= n - 5; i--) {
                if (H[i] === H[i - 1]) { zig = false; break; }
            }
            if (zig) return { type: 'cau_zigzag', label: CAU_CATALOG.cau_zigzag.name, pattern: H.slice(-6).join('') };
        }

        if (n >= 6 && streak >= 2) {
            const before = H[n - streak - 1];
            if (before && before !== last) {
                let prevStreak = 1;
                for (let i = n - streak - 2; i >= 0; i--) {
                    if (H[i] === before) prevStreak++;
                    else break;
                }
                if (prevStreak >= 3) return { type: 'cau_dao', label: CAU_CATALOG.cau_dao.name, pattern: before.repeat(prevStreak) + last.repeat(streak) };
            }
        }

        const last10 = H.slice(-10);
        const b10 = last10.filter(x => x === 'B').length;
        const p10 = last10.filter(x => x === 'P').length;
        if (last10.length >= 8) {
            if (b10 >= 7) return { type: 'cau_nghieng', label: CAU_CATALOG.cau_nghieng.name, pattern: last10.join('') };
            if (p10 >= 7) return { type: 'cau_nghieng', label: CAU_CATALOG.cau_nghieng.name, pattern: last10.join('') };
        }

        if (n >= 6 && streak === 1) {
            const before = H[n - 2];
            let prevStreak = 1;
            for (let i = n - 3; i >= 0; i--) {
                if (H[i] === before) prevStreak++;
                else break;
            }
            if (prevStreak >= 3) return { type: 'cau_gay', label: CAU_CATALOG.cau_gay.name, pattern: before.repeat(prevStreak) + last };
        }

        if (n >= 6) {
            const seg = H.slice(-6).join('');
            if (seg === 'BBPPBB' || seg === 'PPBBPP' || seg === 'BBPPBB') return { type: 'cau_doi', label: CAU_CATALOG.cau_doi.name, pattern: seg };
        }

        return { type: 'cau_hon_hop', label: CAU_CATALOG.cau_hon_hop.name, pattern: H.slice(-8).join('') };
    }

    static detectPBPT(history) {
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

        const third = Math.floor(n / 3);
        let trend = 'stable';
        if (third >= 3) {
            const recentB = H.slice(-third).filter(x => x === 'B').length;
            const oldB = H.slice(0, third).filter(x => x === 'B').length;
            if (recentB - oldB >= 2) trend = 'B_up';
            else if (oldB - recentB >= 2) trend = 'P_up';
        }

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
// AML MANAGER — THUẬT TOÁN CŨ (GIỮ NGUYÊN)
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
        const books = dump.books || dump;
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

// ============================================================================
// 🚀 THUẬT TOÁN MỚI — AML V2 VIP (BRAKE LEARNING)
//     - Không random
//     - Không cứng học cầu (học multi-pattern 4→12)
//     - Tiếp tục học cầu (pushResult sau mỗi phiên)
//     - Nhận diện cầu theo mọi mặt
//     - TỰ BẺ HƯỚNG khi gặp mẫu sai
//     - 🔒 KHỐNG CHẾ KHÔNG SAI QUÁ 3–4 PHIÊN LIÊN TIẾP (Fail-Safe Brake)
// ============================================================================
const VIP = {
    MIN_PATTERN_LEN: 4,
    MAX_PATTERN_LEN: 12,
    DECAY: 0.95,
    DECAY_EVERY: 50,
    BOOST_CORRECT: 1.0,
    PENALTY_WRONG: -1.5,
    FLIP_THRESHOLD: 0.35,
    MAX_CONSECUTIVE_WRONG: 3,
    BRAKE_RELEASE_AFTER: 1,
    RATIO_MIN: 55.0,
    RATIO_MAX: 89.0,
    STATE_FILE: path.join(__dirname, 'vip_state.json'),
    STATE_BACKUP: path.join(__dirname, 'vip_state_backup.json')
};

// ---------------------------------------------------------------------------
// VIPPatternBook — sổ mẫu cầu của thuật toán mới
// ---------------------------------------------------------------------------
class VIPPatternBook {
    constructor() {
        this.book = new Map();          // key: pattern string -> VIPRecord
        this.history = [];              // chuỗi kết quả B/P/T
        this.lastPrediction = null;     // { pattern_set, pred, history_len }
        this.sessionsSinceDecay = 0;
        this.stats = { total: 0, correct: 0, wrong: 0 };
    }

    _newRecord() {
        return {
            count: 0,
            predict_B: 0, predict_P: 0, predict_T: 0,
            wrong_B: 0, wrong_P: 0, wrong_T: 0,
            flip_B: 0, flip_P: 0, flip_T: 0,
            ban_B: false, ban_P: false, ban_T: false,
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

    /**
     * Nạp 1 kết quả mới vào lịch sử + cập nhật mẫu + settle dự đoán trước
     */
    pushResult(r) {
        if (!['B', 'P', 'T'].includes(r)) return;

        this.history.push(r);
        const endIdx = this.history.length;

        // Bước 2 — học mẫu (mẫu kết thúc tại vị trí cuối của history TRƯỚC kết quả mới)
        for (let L = VIP.MIN_PATTERN_LEN; L <= VIP.MAX_PATTERN_LEN; L++) {
            if (endIdx - L < 1) break;
            const patArr = this.history.slice(endIdx - L - 1, endIdx - 1);
            const pat = patArr.join('');
            if (!pat) continue;
            const rec = this._get(pat);
            rec.count += 1;
            rec['predict_' + r] += 1;
        }

        // Bước 3+6 — settle dự đoán trước (nếu khớp history_len)
        if (this.lastPrediction && this.lastPrediction.history_len === endIdx - 1) {
            this._settle(this.lastPrediction, r);
            this.lastPrediction = null;
        }

        // Bước 8 — decay định kỳ
        this.sessionsSinceDecay++;
        if (this.sessionsSinceDecay >= VIP.DECAY_EVERY) {
            for (const rec of this.book.values()) {
                rec.weight *= VIP.DECAY;
                if (rec.weight < 0.1) {
                    rec.ban_B = rec.ban_P = rec.ban_T = false;
                }
            }
            this.sessionsSinceDecay = 0;
        }
    }

    /**
     * Bước 3+7 — học từ sai + bẻ hướng + gắn ban
     */
    _settle(last, actual) {
        const ok = (actual === last.pred);
        this.stats.total++;
        if (ok) this.stats.correct++;
        else this.stats.wrong++;

        for (const entry of last.pattern_set) {
            const rec = this.book.get(entry.pat);
            if (!rec) continue;

            if (ok) {
                rec.weight += VIP.BOOST_CORRECT;
            } else {
                rec.weight += VIP.PENALTY_WRONG;
                rec['wrong_' + last.pred] += 1;
                rec['flip_'  + last.pred] += 1;

                const total = rec.predict_B + rec.predict_P + rec.predict_T;
                if (total > 0 && (rec['wrong_' + last.pred] / total) > VIP.FLIP_THRESHOLD) {
                    rec['ban_' + last.pred] = true;
                }
            }
        }
    }

    /**
     * Bước 4 — dự đoán bằng argmax trọng số đã học, có xử lý ban
     */
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
                source: 'vip_empty',
                banned_hits: 0
            };
        }

        const candidates = [];
        let bannedHits = 0;

        for (let L = 1; L <= VIP.MAX_PATTERN_LEN; L++) {
            if (n < L) break;
            const pat = H.slice(H.length - L).join('');
            const rec = this.book.get(pat);
            if (!rec) continue;
            const total = rec.predict_B + rec.predict_P + rec.predict_T;
            if (total === 0) continue;

            let sB = (rec.predict_B - rec.wrong_B) / total;
            let sP = (rec.predict_P - rec.wrong_P) / total;
            let sT = (rec.predict_T - rec.wrong_T) / total;

            if (rec.ban_B) { sB = -1; bannedHits++; }
            if (rec.ban_P) { sP = -1; bannedHits++; }
            if (rec.ban_T) { sT = -1; bannedHits++; }

            candidates.push({
                pat, L,
                score_B: sB, score_P: sP, score_T: sT,
                weight: rec.weight
            });
        }

        if (candidates.length === 0) {
            return this._fallbackPredict(H, 'vip_fallback_stats');
        }

        let W_B = 0, W_P = 0, W_T = 0;
        for (const c of candidates) {
            const w = Math.max(0.0001, c.weight);
            W_B += c.score_B * w;
            W_P += c.score_P * w;
            W_T += c.score_T * w;
        }

        if (W_B + W_P + W_T < 1e-9) {
            return this._fallbackPredict(H, 'vip_fallback_zero');
        }

        const scores = { B: W_B, P: W_P, T: W_T };
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
            source: 'vip_pattern_book',
            banned_hits: bannedHits
        };
    }

    _fallbackPredict(H, source) {
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
        const recent = H.slice(-Math.min(10, n));
        let rB = 0, rP = 0, rT = 0;
        for (const ch of recent) {
            if (ch === 'B') rB++;
            else if (ch === 'P') rP++;
            else if (ch === 'T') rT++;
        }
        const m = recent.length || 1;
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
            source,
            banned_hits: 0
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
        const pb = new VIPPatternBook();
        pb.history = obj.history || [];
        pb.stats = obj.stats || { total: 0, correct: 0, wrong: 0 };
        pb.sessionsSinceDecay = obj.sessionsSinceDecay || 0;
        pb.book = new Map(obj.book || []);
        // đảm bảo record có đủ field ban_/flip_
        for (const [, rec] of pb.book) {
            if (rec.flip_B === undefined) rec.flip_B = 0;
            if (rec.flip_P === undefined) rec.flip_P = 0;
            if (rec.flip_T === undefined) rec.flip_T = 0;
            if (rec.ban_B === undefined) rec.ban_B = false;
            if (rec.ban_P === undefined) rec.ban_P = false;
            if (rec.ban_T === undefined) rec.ban_T = false;
        }
        return pb;
    }
}

// ---------------------------------------------------------------------------
// VIPBrakeState — trạng thái phanh của 1 bàn
// ---------------------------------------------------------------------------
class VIPBrakeState {
    constructor() {
        this.streak_wrong = 0;
        this.streak_correct = 0;
        this.last_pred = null;
        this.last_actual = null;
        this.brake_mode = false;
        this.last_pred_pre_brake = null; // để so sánh
        this.brake_activations = 0;      // thống kê
        this.max_streak_wrong_ever = 0;  // kỷ lục
    }

    record(actual, prediction) {
        const ok = (actual === prediction);
        this.last_pred = prediction;
        this.last_actual = actual;

        if (ok) {
            this.streak_correct += 1;
            this.streak_wrong = 0;
            if (this.brake_mode) {
                this.brake_mode = false;
            }
        } else {
            this.streak_wrong += 1;
            this.streak_correct = 0;
            if (this.streak_wrong >= VIP.MAX_CONSECUTIVE_WRONG) {
                if (!this.brake_mode) this.brake_activations += 1;
                this.brake_mode = true;
            }
            if (this.streak_wrong > this.max_streak_wrong_ever) {
                this.max_streak_wrong_ever = this.streak_wrong;
            }
        }
    }

    /**
     * Áp dụng phanh lên prediction thô
     * @param {string} rawPred prediction thô từ VIPPatternBook
     * @param {{B:number,P:number,T:number}} scores
     * @returns {{finalPred:string, brakeApplied:boolean, reason:string}}
     */
    apply(rawPred, scores) {
        let finalPred = rawPred;
        let brakeApplied = false;
        let reason = 'none';

        if (this.streak_wrong >= VIP.MAX_CONSECUTIVE_WRONG) {
            this.brake_mode = true;
        }

        if (this.brake_mode) {
            // Nếu trùng hướng đang thua → bẻ sang hướng tốt thứ 2
            if (this.last_pred && finalPred === this.last_pred) {
                finalPred = pickSecondBest(scores, this.last_pred);
                brakeApplied = true;
                reason = 'flip_from_last_wrong';
            }
            // Nếu vẫn còn sai tiếp (streak > 3) → ép sang hướng thứ 3
            if (this.streak_wrong >= VIP.MAX_CONSECUTIVE_WRONG + 1) {
                const avoid = [this.last_pred, finalPred].filter(Boolean);
                const forced = pickThirdBest(scores, avoid);
                if (forced) {
                    finalPred = forced;
                    brakeApplied = true;
                    reason = 'forced_third_direction';
                }
            }
        }

        return { finalPred, brakeApplied, reason };
    }

    toJSON() {
        return {
            streak_wrong: this.streak_wrong,
            streak_correct: this.streak_correct,
            last_pred: this.last_pred,
            last_actual: this.last_actual,
            brake_mode: this.brake_mode,
            brake_activations: this.brake_activations,
            max_streak_wrong_ever: this.max_streak_wrong_ever
        };
    }

    static fromJSON(o) {
        const s = new VIPBrakeState();
        if (!o) return s;
        s.streak_wrong = o.streak_wrong || 0;
        s.streak_correct = o.streak_correct || 0;
        s.last_pred = o.last_pred || null;
        s.last_actual = o.last_actual || null;
        s.brake_mode = !!o.brake_mode;
        s.brake_activations = o.brake_activations || 0;
        s.max_streak_wrong_ever = o.max_streak_wrong_ever || 0;
        return s;
    }
}

// ---------------------------------------------------------------------------
// Helper chọn hướng
// ---------------------------------------------------------------------------
function pickSecondBest(scores, exclude) {
    const arr = ['B', 'P', 'T']
        .filter(k => k !== exclude)
        .map(k => ({ k, v: scores[k] !== undefined ? scores[k] : -Infinity }))
        .sort((a, b) => b.v - a.v);
    return arr[0] ? arr[0].k : (exclude === 'B' ? 'P' : 'B');
}

function pickThirdBest(scores, avoid) {
    const arr = ['B', 'P', 'T']
        .filter(k => !avoid.includes(k))
        .map(k => ({ k, v: scores[k] !== undefined ? scores[k] : -Infinity }))
        .sort((a, b) => b.v - a.v);
    return arr[0] ? arr[0].k : null;
}

// ---------------------------------------------------------------------------
// VIPManager — quản lý thuật toán VIP (mới)
// ---------------------------------------------------------------------------
class VIPManager {
    constructor() {
        this.tables = new Map(); // tableName -> { book: VIPPatternBook, brake: VIPBrakeState, lastKnownResult }
        this.learningStartTime = null;
        this.lastSaveTime = null;
        this.createdAt = new Date().toISOString();
    }

    sync(tableName, resultString) {
        if (!resultString) return;

        let entry = this.tables.get(tableName);
        if (!entry) {
            entry = { book: new VIPPatternBook(), brake: new VIPBrakeState(), lastKnownResult: '' };
            this.tables.set(tableName, entry);
            this._ingest(entry, '');
            entry.lastKnownResult = '';
        }

        const prev = entry.lastKnownResult;
        if (resultString.length > prev.length) {
            if (resultString.startsWith(prev)) {
                const added = resultString.slice(prev.length);
                for (const ch of added) {
                    this._ingestOne(entry, ch);
                }
            } else {
                // reset sổ
                entry.book = new VIPPatternBook();
                entry.brake = new VIPBrakeState();
                for (const ch of resultString) this._ingestOne(entry, ch);
            }
            entry.lastKnownResult = resultString;
        } else if (resultString.length < prev.length) {
            entry.book = new VIPPatternBook();
            entry.brake = new VIPBrakeState();
            for (const ch of resultString) this._ingestOne(entry, ch);
            entry.lastKnownResult = resultString;
        }
    }

    _ingest(entry, _s) { /* no-op placeholder */ }

    _ingestOne(entry, ch) {
        // trước khi push, lấy prediction cũ để settle brake
        const beforeLen = entry.book.history.length;
        if (entry.book.lastPrediction && entry.book.lastPrediction.history_len === beforeLen) {
            // settle brake trước khi push
            const settledPred = entry.book.lastPrediction.pred;
            // áp dụng phanh để biết prediction thực đã dùng
            // -> brake đã được record từ trước, giờ record kết quả thật
            entry.brake.record(ch, entry._lastFinalPred || settledPred);
        }
        entry.book.pushResult(ch);
    }

    getPrediction(tableName) {
        const entry = this.tables.get(tableName);
        if (!entry) return null;

        const book = entry.book;
        const brake = entry.brake;
        const H = book.history;
        const n = H.length;

        // Dự đoán thô từ pattern book
        const raw = book.predict();
        const rawPred = raw.pred || 'B';

        // Áp dụng phanh
        const { finalPred, brakeApplied, reason } = brake.apply(rawPred, raw.scores);

        // Lưu prediction cuối cùng để settle chính xác
        entry._lastFinalPred = finalPred;

        // Tính tỉ lệ
        const W_sum = raw.scores.B + raw.scores.P + raw.scores.T;
        const ratioByWeight = W_sum > 0 ? (raw.scores[finalPred] / W_sum) : 0.34;

        const patternSet = (book.lastPrediction && book.lastPrediction.pattern_set) || [];
        let totalSamples = 0;
        let correctSamples = 0;
        for (const c of patternSet) {
            const rec = book.book.get(c.pat);
            if (!rec) continue;
            totalSamples += rec.count;
            const wrongForPred = rec['wrong_' + finalPred] || 0;
            correctSamples += Math.max(0, rec['predict_' + finalPred] - wrongForPred);
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
        if (percent < VIP.RATIO_MIN) percent = VIP.RATIO_MIN + (percent / 100) * 5;
        if (percent > VIP.RATIO_MAX) percent = VIP.RATIO_MAX;

        let cau;
        if (patternSet.length > 0) {
            const longest = [...patternSet].sort((a, b) => b.L - a.L)[0];
            cau = longest.pat;
        } else {
            cau = H.slice(-VIP.MAX_PATTERN_LEN).join('');
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
            "dự đoán": finalPred,
            "tỉ lệ": percent.toFixed(1) + '%',
            "thuật_toán": "VIP_AML_V2_BRAKE",
            "raw_pred": rawPred,
            "brake_active": !!brake.brake_mode,
            "brake_applied": brakeApplied,
            "brake_reason": reason,
            "streak_wrong": brake.streak_wrong,
            "streak_correct": brake.streak_correct,
            "max_streak_wrong": brake.max_streak_wrong_ever,
            "brake_activations": brake.brake_activations,
            "confidence": raw.confidence,
            "source": raw.source,
            "banned_hits": raw.banned_hits || 0,
            "phân_bố": pbpt.distribution,
            "xu_hướng": pbpt.trend,
            "đối_xứng": pbpt.symmetry,
            "thống_kê": book.stats
        };
    }

    getAllPredictions() {
        const out = [];
        for (const [tableName] of this.tables) {
            const p = this.getPrediction(tableName);
            if (p) out.push(p);
        }
        return out;
    }

    compare(tableName) {
        const oldP = aml.getPrediction(tableName);
        const newP = this.getPrediction(tableName);
        if (!oldP && !newP) return null;
        return {
            "bàn": tableName,
            "thuật_toán_cũ": oldP,
            "thuật_toán_mới_VIP": newP,
            "khớp_nhau": oldP && newP ? (oldP['dự đoán'] === newP['dự đoán']) : null
        };
    }

    saveToFile() {
        try {
            const dump = {
                savedAt: new Date().toISOString(),
                createdAt: this.createdAt,
                learningStartTime: this.learningStartTime,
                tables: {}
            };
            for (const [t, e] of this.tables) {
                dump.tables[t] = {
                    book: e.book.toJSON(),
                    brake: e.brake.toJSON(),
                    lastKnownResult: e.lastKnownResult
                };
            }
            try {
                if (fs.existsSync(VIP.STATE_FILE)) {
                    fs.copyFileSync(VIP.STATE_FILE, VIP.STATE_BACKUP);
                }
            } catch (e) {}
            fs.writeFileSync(VIP.STATE_FILE, JSON.stringify(dump));
            this.lastSaveTime = new Date();
            console.log(`[VIP] Đã lưu state (${Object.keys(dump.tables).length} bàn) lúc ${this.lastSaveTime.toISOString()}`);
        } catch (err) {
            console.error('[VIP] Lỗi lưu state:', err.message);
        }
    }

    loadFromFile() {
        try {
            let file = VIP.STATE_FILE;
            if (!fs.existsSync(file) && fs.existsSync(VIP.STATE_BACKUP)) file = VIP.STATE_BACKUP;
            if (!fs.existsSync(file)) return false;
            const dump = JSON.parse(fs.readFileSync(file, 'utf8'));
            this.learningStartTime = dump.learningStartTime || new Date().toISOString();
            this.createdAt = dump.createdAt || this.createdAt;
            const tables = dump.tables || {};
            for (const [t, obj] of Object.entries(tables)) {
                this.tables.set(t, {
                    book: VIPPatternBook.fromJSON(obj.book),
                    brake: VIPBrakeState.fromJSON(obj.brake),
                    lastKnownResult: obj.lastKnownResult || ''
                });
            }
            console.log(`[VIP] Đã khôi phục state (${this.tables.size} bàn)`);
            return true;
        } catch (err) {
            console.error('[VIP] Lỗi load state:', err.message);
            return false;
        }
    }

    startLearning() {
        if (!this.learningStartTime) {
            this.learningStartTime = new Date().toISOString();
            console.log(`[VIP] Bắt đầu học cầu lúc ${this.learningStartTime}`);
        }
    }

    isLearningPhase() {
        if (!this.learningStartTime) return false;
        const elapsed = Date.now() - new Date(this.learningStartTime).getTime();
        return elapsed < AML_LEARN_DURATION_MS;
    }

    summary() {
        let totalW = 0, totalC = 0, totalWrong = 0, brakeActs = 0, maxStreak = 0;
        for (const [, e] of this.tables) {
            totalW += e.book.stats.total;
            totalC += e.book.stats.correct;
            totalWrong += e.book.stats.wrong;
            brakeActs += e.brake.brake_activations;
            if (e.brake.max_streak_wrong_ever > maxStreak) maxStreak = e.brake.max_streak_wrong_ever;
        }
        return {
            total_tables: this.tables.size,
            total_predictions: totalW,
            correct: totalC,
            wrong: totalWrong,
            accuracy: totalW > 0 ? ((totalC / totalW) * 100).toFixed(2) + '%' : '—',
            brake_activations_total: brakeActs,
            max_streak_wrong_ever: maxStreak
        };
    }
}

const vip = new VIPManager();

// ============================================================
// SYNC DATA → 2 THUẬT TOÁN SONG SONG
// ============================================================
function syncBothAlgorithms() {
    for (const item of baccaratData) {
        if (!item.table || !item.result) continue;
        try { aml.sync(item.table, item.result); } catch (e) { console.error('[AML sync]', e.message); }
        try { vip.sync(item.table, item.result); } catch (e) { console.error('[VIP sync]', e.message); }
    }
}

// giữ tên hàm cũ để không vỡ code
function syncAMLFromData() { syncBothAlgorithms(); }

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
            syncBothAlgorithms();
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

// ---------- ROOT ----------
app.get('/', (req, res) => {
    res.json({
        name: 'Baccarat API Server — 2 Thuật toán song song',
        status: 'running',
        algorithms: {
            OLD: {
                name: 'BCR-AML (thuật toán cũ của bạn)',
                endpoints: ['/api/predict', '/api/predict/:table', '/api/aml-status']
            },
            VIP: {
                name: 'VIP_AML_V2_BRAKE (thuật toán mới — có Fail-Safe Brake chống sai >3-4 phiên)',
                endpoints: ['/api/vip/predict', '/api/vip/predict/:table', '/api/vip/status', '/api/vip/compare/:table']
            }
        },
        learning: {
            old_learning: aml.isLearningPhase(),
            vip_learning: vip.isLearningPhase()
        },
        endpoints: [
            '/api/baccarat', '/api/baccarat/:table', '/api/latest',
            '/api/predict', '/api/predict/:table', '/api/cau-catalog', '/api/aml-status',
            '/api/vip/predict', '/api/vip/predict/:table', '/api/vip/status', '/api/vip/compare/:table',
            '/api/compare-all'
        ]
    });
});

// ---------- DỮ LIỆU RAW ----------
app.get('/api/baccarat', (req, res) => {
    res.json({ success: true, data: baccaratData, lastUpdate, total: baccaratData.length });
});

app.get('/api/baccarat/:table', (req, res) => {
    const found = baccaratData.find(item => item.table === req.params.table);
    if (found) res.json({ success: true, data: found });
    else res.json({ success: false, message: 'Không tìm thấy bàn ' + req.params.table });
});

app.get('/api/latest', (req, res) => {
    const latest = [...baccaratData].sort((a, b) => {
        const numA = parseInt(a.table) || 0;
        const numB = parseInt(b.table) || 0;
        return numB - numA;
    });
    res.json({ success: true, data: latest.slice(0, 10), lastUpdate });
});

// ---------- THUẬT TOÁN CŨ (giữ nguyên endpoint) ----------
app.get('/api/predict', (req, res) => {
    const all = aml.getAllPredictions();
    res.json({
        success: true,
        algorithm: 'OLD_BCR_AML',
        total: all.length,
        data: all,
        learning: aml.isLearningPhase(),
        lastUpdate
    });
});

app.get('/api/predict/:table', (req, res) => {
    const p = aml.getPrediction(req.params.table);
    if (!p) return res.json({ success: false, message: 'Bàn chưa có dữ liệu: ' + req.params.table });
    res.json({ success: true, algorithm: 'OLD_BCR_AML', data: p, lastUpdate });
});

app.get('/api/cau-catalog', (req, res) => {
    res.json({ success: true, catalog: CAU_CATALOG });
});

app.get('/api/aml-status', (req, res) => {
    res.json({
        success: true,
        algorithm: 'OLD_BCR_AML',
        learningStartTime: aml.learningStartTime,
        isLearning: aml.isLearningPhase(),
        lastSaveTime: aml.lastSaveTime,
        totalBooks: aml.books.size,
        tables: Array.from(aml.books.keys()).slice(0, 100)
    });
});

// ============================================================
// 🚀 API VIP — THUẬT TOÁN MỚI (Fail-Safe Brake)
// ============================================================
app.get('/api/vip/predict', (req, res) => {
    const all = vip.getAllPredictions();
    res.json({
        success: true,
        algorithm: 'VIP_AML_V2_BRAKE',
        description: 'Thuật toán mới: bẻ hướng + ban mẫu sai + phanh chống sai >3-4 phiên liên tiếp',
        total: all.length,
        data: all,
        summary: vip.summary(),
        learning: vip.isLearningPhase(),
        lastUpdate
    });
});

app.get('/api/vip/predict/:table', (req, res) => {
    const p = vip.getPrediction(req.params.table);
    if (!p) return res.json({ success: false, message: 'Bàn chưa có dữ liệu: ' + req.params.table });
    res.json({ success: true, algorithm: 'VIP_AML_V2_BRAKE', data: p, lastUpdate });
});

app.get('/api/vip/status', (req, res) => {
    res.json({
        success: true,
        algorithm: 'VIP_AML_V2_BRAKE',
        createdAt: vip.createdAt,
        learningStartTime: vip.learningStartTime,
        isLearning: vip.isLearningPhase(),
        lastSaveTime: vip.lastSaveTime,
        totalTables: vip.tables.size,
        summary: vip.summary(),
        config: {
            MIN_PATTERN_LEN: VIP.MIN_PATTERN_LEN,
            MAX_PATTERN_LEN: VIP.MAX_PATTERN_LEN,
            FLIP_THRESHOLD: VIP.FLIP_THRESHOLD,
            MAX_CONSECUTIVE_WRONG: VIP.MAX_CONSECUTIVE_WRONG,
            PENALTY_WRONG: VIP.PENALTY_WRONG,
            BOOST_CORRECT: VIP.BOOST_CORRECT,
            DECAY: VIP.DECAY,
            DECAY_EVERY: VIP.DECAY_EVERY
        },
        tables: Array.from(vip.tables.keys()).slice(0, 100)
    });
});

app.get('/api/vip/compare/:table', (req, res) => {
    const cmp = vip.compare(req.params.table);
    if (!cmp) return res.json({ success: false, message: 'Chưa có dữ liệu bàn: ' + req.params.table });
    res.json({ success: true, ...cmp });
});

// ---------- So sánh toàn bộ ----------
app.get('/api/compare-all', (req, res) => {
    const tables = new Set([...aml.books.keys(), ...vip.tables.keys()]);
    const rows = [];
    let match = 0, mismatch = 0;
    for (const t of tables) {
        const oldP = aml.getPrediction(t);
        const newP = vip.getPrediction(t);
        const same = oldP && newP ? oldP['dự đoán'] === newP['dự đoán'] : null;
        if (same === true) match++;
        if (same === false) mismatch++;
        rows.push({
            "bàn": t,
            "cũ": oldP ? oldP['dự đoán'] : null,
            "VIP": newP ? newP['dự đoán'] : null,
            "khớp": same,
            "brake_active": newP ? newP['brake_active'] : null
        });
    }
    res.json({
        success: true,
        total: rows.length,
        match,
        mismatch,
        data: rows
    });
});

// ======================
// KHỞI ĐỘNG
// ======================
async function start() {
    console.log('==================================================');
    console.log('BACCARAT API — 2 THUẬT TOÁN SONG SONG');
    console.log('  [1] OLD: BCR-AML (giữ nguyên code gốc)');
    console.log('  [2] VIP: VIP_AML_V2_BRAKE (mới — chống sai >3-4 phiên)');
    console.log('==================================================');

    aml.loadFromFile();
    if (!aml.learningStartTime) aml.startLearning();

    vip.loadFromFile();
    if (!vip.learningStartTime) vip.startLearning();

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

    // Lưu định kỳ cả 2 thuật toán
    setInterval(() => {
        aml.saveToFile();
        vip.saveToFile();
    }, AML_SAVE_INTERVAL_MS);

    aml.saveToFile();
    vip.saveToFile();

    autoUpdate();

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 API SERVER ĐANG CHẠY TRÊN PORT ${PORT}`);
        console.log(`\n--- THUẬT TOÁN CŨ ---`);
        console.log(`   http://localhost:${PORT}/api/predict`);
        console.log(`   http://localhost:${PORT}/api/predict/:table`);
        console.log(`   http://localhost:${PORT}/api/aml-status`);
        console.log(`\n--- 🌟 THUẬT TOÁN MỚI (VIP) ---`);
        console.log(`   http://localhost:${PORT}/api/vip/predict`);
        console.log(`   http://localhost:${PORT}/api/vip/predict/:table`);
        console.log(`   http://localhost:${PORT}/api/vip/status`);
        console.log(`   http://localhost:${PORT}/api/vip/compare/:table`);
        console.log(`\n--- SO SÁNH ---`);
        console.log(`   http://localhost:${PORT}/api/compare-all`);
    });
}

start();
