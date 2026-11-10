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
// TÀI LIỆU CẦU BACCARAT FULL 5 PHẦN
// ============================================================
const CAU_DOCUMENT = {
    PHAN_1_DANH_MUC: {
        title: "PHẦN 1 – DANH MỤC TOÀN BỘ CÁC LOẠI CẦU",
        items: [
            { id: 1, ten: "Cầu bệt (cầu dọc)", mo_ta: "Chuỗi kết quả cùng một cửa liên tiếp từ 4-5 phiên trở lên. Ví dụ: BBBBBB hoặc PPPPPP" },
            { id: 2, ten: "Cầu 1-1 (cầu ngang, cầu đối xứng)", mo_ta: "Kết quả xen kẽ đều đặn B-P-B-P-B-P. Dấu hiệu nhận biết rõ ràng nhất trong Baccarat." },
            { id: 3, ten: "Cầu 1-2", mo_ta: "Chuỗi 1 B rồi 2 P, lặp lại: B-PP-B-PP-B-PP" },
            { id: 4, ten: "Cầu 2-1", mo_ta: "Chuỗi 2 B rồi 1 P, lặp lại: BB-P-BB-P-BB-P" },
            { id: 5, ten: "Cầu 1-3", mo_ta: "Chuỗi 1 B rồi 3 P, lặp lại: B-PPP-B-PPP" },
            { id: 6, ten: "Cầu 3-1", mo_ta: "Chuỗi 3 B rồi 1 P, lặp lại: BBB-P-BBB-P" },
            { id: 7, ten: "Cầu 2-2", mo_ta: "Chuỗi 2 B rồi 2 P, lặp lại: BB-PP-BB-PP" },
            { id: 8, ten: "Cầu 3-3", mo_ta: "Chuỗi 3 B rồi 3 P, lặp lại: BBB-PPP-BBB-PPP" },
            { id: 9, ten: "Cầu 4-4", mo_ta: "Chuỗi 4 B rồi 4 P, lặp lại: BBBB-PPPP-BBBB-PPPP" },
            { id: 10, ten: "Cầu nghiêng / cầu chéo", mo_ta: "Xu hướng kết quả nghiêng về một cửa trong nhiều phiên, không theo pattern cố định nhưng có độ dài bệt tăng dần." },
            { id: 11, ten: "Cầu rồng (cầu dài bất thường)", mo_ta: "Chuỗi bệt kéo dài từ 8-10 phiên trở lên, hiếm gặp nhưng khi xuất hiện thường gây bất ngờ." },
            { id: 12, ten: "Cầu gãy (cầu đứt quãng)", mo_ta: "Pattern đang đều bỗng nhiên bị phá vỡ bởi một kết quả khác, sau đó có thể quay lại pattern cũ." },
            { id: 13, ten: "Cầu hỗn hợp / cầu không ổn định", mo_ta: "Không có pattern rõ ràng, kết quả thay đổi liên tục không theo quy luật nào." },
            { id: 14, ten: "Cầu đảo (bẻ hướng)", mo_ta: "Cầu đang bệt một cửa bỗng đổi sang cửa ngược lại và duy trì bệt mới." },
            { id: 15, ten: "Cầu soi cầu (cầu ảo, cầu mồi)", mo_ta: "Pattern ngắn xuất hiện rồi biến mất, đánh lừa người chơi. Thường chỉ kéo dài 3-4 phiên." },
            { id: 16, ten: "Cầu bệt xen kẽ", mo_ta: "Các đoạn bệt ngắn xen kẽ với nhau: BBB-PPPP-BB-PPP" },
            { id: 17, ten: "Cầu 1-1-2 (phức hợp)", mo_ta: "Chuỗi B-P-BB lặp lại: B-P-BB-B-P-BB" },
            { id: 18, ten: "Cầu 2-1-1 (phức hợp)", mo_ta: "Chuỗi BB-P-B lặp lại: BB-P-B-BB-P-B" },
            { id: 19, ten: "Cầu 1-2-1 (phức hợp)", mo_ta: "Chuỗi B-PP-B lặp lại: B-PP-B-B-PP-B" },
            { id: 20, ten: "Cầu tam giác", mo_ta: "Pattern tăng dần độ dài: B-PP-BBB-PPPP (mỗi cửa tăng thêm 1)" },
            { id: 21, ten: "Cầu zigzag", mo_ta: "Kết quả nhảy không đều: BB-P-BBB-PP-B-PPP" },
            { id: 22, ten: "Cầu chuỗi (streak)", mo_ta: "Tương tự cầu bệt nhưng tập trung vào đếm số phiên liên tiếp của một cửa." },
            { id: 23, ten: "Cầu đôi (double)", mo_ta: "Kết quả luôn đi theo cặp: BB-PP-BB-PP (tương tự 2-2)" },
            { id: 24, ten: "Cầu 1-1-1-2", mo_ta: "Chuỗi B-P-B-BB lặp lại, biến thể của cầu phức hợp" },
            { id: 25, ten: "Cầu đối xứng gương", mo_ta: "Pattern đối xứng qua trục: B-PP-B-B-PP-B" }
        ]
    },
    PHAN_2_PHAN_TICH: {
        title: "PHẦN 2 – CÁCH PHÂN TÍCH & PHÂN BIỆT TỪNG LOẠI CẦU",
        items: [
            { ten: "Cầu bệt", dau_hieu: "≥4 kết quả giống nhau liên tiếp", phan_biet: "Khác cầu rồng ở độ dài (bệt 4-7, rồng ≥8)", vi_du: "BBBBBB", do_dai_min: 4, xac_suat: "~12-15% xuất hiện trong 100 phiên" },
            { ten: "Cầu 1-1", dau_hieu: "B-P-B-P-B-P chính xác", phan_biet: "Khác zigzag ở tính đều đặn tuyệt đối", vi_du: "BPBPBPBP", do_dai_min: 4, xac_suat: "~25% trong 100 phiên" },
            { ten: "Cầu 1-2", dau_hieu: "B-PP lặp lại ≥2 lần", phan_biet: "Khác 2-1 ở thứ tự cửa", vi_du: "BPPBPPBPP", do_dai_min: 6, xac_suat: "~8%" },
            { ten: "Cầu 2-1", dau_hieu: "BB-P lặp lại ≥2 lần", phan_biet: "Khác 1-2 ở vị trí cửa đơn", vi_du: "BBPBBPBBP", do_dai_min: 6, xac_suat: "~8%" },
            { ten: "Cầu 1-3", dau_hieu: "B-PPP lặp lại", phan_biet: "Chuỗi đơn ngắn hơn chuỗi bệt", vi_du: "BPPPBPPPB", do_dai_min: 8, xac_suat: "~4%" },
            { ten: "Cầu 3-1", dau_hieu: "BBB-P lặp lại", phan_biet: "Tương tự 1-3 nhưng đảo cửa", vi_du: "BBB-PBBB-P", do_dai_min: 8, xac_suat: "~4%" },
            { ten: "Cầu 2-2", dau_hieu: "BB-PP lặp lại ≥2 lần", phan_biet: "Khác 1-1 ở độ dài nhóm", vi_du: "BBPPBBPP", do_dai_min: 8, xac_suat: "~6%" },
            { ten: "Cầu 3-3", dau_hieu: "BBB-PPP lặp lại", phan_biet: "Độ dài nhóm = 3", vi_du: "BBBPPPBBBPPP", do_dai_min: 12, xac_suat: "~2%" },
            { ten: "Cầu 4-4", dau_hieu: "BBBB-PPPP lặp lại", phan_biet: "Độ dài nhóm = 4", vi_du: "BBBBPPPPBBBB", do_dai_min: 16, xac_suat: "~1%" },
            { ten: "Cầu nghiêng", dau_hieu: "Tỉ lệ B/P lệch >65/35 trong 20 phiên", phan_biet: "Không có pattern cố định nhưng xu hướng rõ", vi_du: "BBPBBBPBBBPBB", do_dai_min: 15, xac_suat: "~20%" },
            { ten: "Cầu rồng", dau_hieu: "≥8 kết quả giống nhau", phan_biet: "Khác cầu bệt ở độ dài cực đoan", vi_du: "BBBBBBBBBB", do_dai_min: 8, xac_suat: "<1%" },
            { ten: "Cầu gãy", dau_hieu: "Pattern đều bỗng bị phá bởi 1 kết quả khác", phan_biet: "Sau khi gãy có thể quay lại pattern cũ", vi_du: "BPBPBP-B-BPBP", do_dai_min: 5, xac_suat: "~15%" },
            { ten: "Cầu hỗn hợp", dau_hieu: "Không tìm được pattern trong 10 phiên gần nhất", phan_biet: "Không có quy luật rõ ràng", vi_du: "BPBBPBPBPPB", do_dai_min: 10, xac_suat: "~30%" },
            { ten: "Cầu đảo", dau_hieu: "Bệt cửa này chuyển sang bệt cửa kia", phan_biet: "Có 2 đoạn bệt nối tiếp nhau", vi_du: "BBBB-PPPP", do_dai_min: 8, xac_suat: "~5%" },
            { ten: "Cầu soi cầu", dau_hieu: "Pattern xuất hiện 3-4 phiên rồi biến mất", phan_biet: "Không duy trì được qua 5 phiên", vi_du: "BPBP-BB-BPBP", do_dai_min: 4, xac_suat: "~20%" },
            { ten: "Cầu bệt xen kẽ", dau_hieu: "Nhiều đoạn bệt ngắn liên tiếp", phan_biet: "Khác cầu đảo ở độ dài đoạn ngắn hơn", vi_du: "BBB-PPPP-BB-PPP", do_dai_min: 10, xac_suat: "~10%" },
            { ten: "Cầu 1-1-2", dau_hieu: "B-P-BB lặp lại", phan_biet: "Pattern 3 nhóm phức hợp", vi_du: "BPBBBPBBB", do_dai_min: 9, xac_suat: "~3%" },
            { ten: "Cầu 2-1-1", dau_hieu: "BB-P-B lặp lại", phan_biet: "Bắt đầu bằng nhóm đôi", vi_du: "BBPBBBPB", do_dai_min: 9, xac_suat: "~3%" },
            { ten: "Cầu 1-2-1", dau_hieu: "B-PP-B lặp lại", phan_biet: "Đối xứng qua nhóm giữa", vi_du: "BPPBBPPB", do_dai_min: 9, xac_suat: "~3%" },
            { ten: "Cầu tam giác", dau_hieu: "Độ dài nhóm tăng dần đều", phan_biet: "Mỗi lần lặp lại tăng thêm 1 đơn vị", vi_du: "B-PP-BBB-PPPP", do_dai_min: 10, xac_suat: "~1%" },
            { ten: "Cầu zigzag", dau_hieu: "Kết quả nhảy không đều nhưng có xu hướng xen kẽ", phan_biet: "Khác 1-1 ở tính không đều đặn", vi_du: "BBPBBBPPBPPP", do_dai_min: 8, xac_suat: "~8%" },
            { ten: "Cầu chuỗi", dau_hieu: "Đếm số phiên liên tiếp cùng cửa", phan_biet: "Tương tự cầu bệt, tập trung vào độ dài streak", vi_du: "BBBBB-PPPP-BBBBB", do_dai_min: 4, xac_suat: "Biến thể của bệt" },
            { ten: "Cầu đôi", dau_hieu: "Kết quả luôn đi cặp 2-2", phan_biet: "Tương tự 2-2 nhưng nhấn mạnh tính cặp đôi", vi_du: "BBPPBBPP", do_dai_min: 8, xac_suat: "~6%" },
            { ten: "Cầu 1-1-1-2", dau_hieu: "B-P-B-BB lặp lại", phan_biet: "Biến thể phức hợp 4 nhóm", vi_du: "BPBBBPBB", do_dai_min: 10, xac_suat: "~2%" },
            { ten: "Cầu đối xứng gương", dau_hieu: "Pattern đối xứng qua trục giữa", phan_biet: "Đọc xuôi = đọc ngược", vi_du: "BPPBBPPB", do_dai_min: 8, xac_suat: "~2%" }
        ]
    },
    PHAN_3_THEO_CAU: {
        title: "PHẦN 3 – CÁCH THEO CẦU",
        nguyen_tac: [
            "Chỉ theo cầu khi đã xác nhận đủ độ dài tối thiểu (≥4 phiên với cầu đơn giản, ≥6 với cầu phức hợp)",
            "Không theo cầu khi cầu đang ở phiên thứ 5-6 của cầu bệt (rủi ro gãy cao)",
            "Luôn theo xu hướng chính, không đoán bừa",
            "Xác định rõ cầu đang chạy trước khi đặt cược",
            "Không đổi cầu giữa chừng khi chưa có dấu hiệu gãy rõ ràng"
        ],
        entry_points: [
            { cau: "Cầu bệt", entry: "Sau phiên thứ 4 cùng cửa, đặt theo cửa đó đến khi gãy" },
            { cau: "Cầu 1-1", entry: "Sau 2 chu kỳ B-P-B-P hoàn chỉnh, đặt ngược cửa vừa ra" },
            { cau: "Cầu 1-2 / 2-1", entry: "Sau 2 chu kỳ hoàn chỉnh, xác định vị trí trong chu kỳ để đặt" },
            { cau: "Cầu 2-2", entry: "Sau 2 chu kỳ BB-PP, đặt theo vị trí chu kỳ hiện tại" },
            { cau: "Cầu 3-3", entry: "Sau 1.5 chu kỳ, xác định đang ở nhóm nào" },
            { cau: "Cầu nghiêng", entry: "Sau 15 phiên, nếu tỉ lệ lệch >65/35 thì theo cửa mạnh" },
            { cau: "Cầu rồng", entry: "Sau phiên thứ 6-7, cân nhắc theo tiếp hoặc dừng tùy độ tin cậy" },
            { cau: "Cầu gãy", entry: "Sau khi gãy 1-2 phiên, quan sát xem có quay lại pattern cũ không" },
            { cau: "Cầu hỗn hợp", entry: "KHÔNG theo, chờ cầu mới hình thành" },
            { cau: "Cầu phức hợp", entry: "Sau 2 chu kỳ đầy đủ, đặt theo vị trí trong chu kỳ" }
        ],
        quan_ly_von: [
            "Chia vốn thành 20-30 phần bằng nhau cho mỗi session",
            "Mỗi lần cược chỉ dùng 1-2% tổng vốn",
            "Khi thắng 3 phiên liên tiếp, tăng nhẹ 1.5x (không quá 2x)",
            "Khi thua 2 phiên liên tiếp, giảm về mức cơ bản",
            "Không bao giờ all-in dù cầu đẹp đến đâu",
            "Đặt stop-loss 20% vốn/ngày, stop-win 30% vốn/ngày"
        ],
        khi_nao_dung: [
            "Cầu đã chạy ≥6 phiên (rủi ro gãy cao)",
            "Cầu bị gãy 2 lần liên tiếp trong 5 phiên",
            "Đã thua 2 phiên liên tiếp theo cầu",
            "Đạt stop-loss hoặc stop-win trong ngày",
            "Cầu chuyển sang hỗn hợp không rõ ràng",
            "Cảm thấy không chắc chắn về pattern hiện tại"
        ]
    },
    PHAN_4_BE_CAU: {
        title: "PHẦN 4 – CÁCH BẺ CẦU",
        dinh_nghia: "Bẻ cầu là đặt cược ngược lại với xu hướng cầu đang chạy, nhằm bắt thời điểm cầu gãy để đổi hướng.",
        dau_hieu_sap_gay: [
            "Cầu bệt đã dài ≥6-7 phiên",
            "Cầu 1-1 đã chạy ≥8 phiên liên tiếp",
            "Cầu phức hợp đã lặp ≥3 chu kỳ hoàn chỉnh",
            "Tỉ lệ thắng của cầu giảm dần qua các phiên",
            "Có dấu hiệu 'mồi' - pattern bị phá nhẹ rồi quay lại",
            "Người chơi xung quanh đồng loạt theo một cửa (dấu hiệu đám đông sai)"
        ],
        thoi_diem_be: [
            "Sau 6-7 phiên bệt liên tiếp - bẻ nhẹ 1 phiên",
            "Sau khi cầu 1-1 chạy 8 phiên - bẻ 1 phiên thử",
            "Khi xuất hiện 2 kết quả khác biệt liên tiếp trong pattern đang đều",
            "Khi cầu phức hợp hoàn thành đúng số chu kỳ dự kiến"
        ],
        chien_thuat: [
            "Bẻ nhẹ: Đặt 50% vốn bình thường ngược cầu, nếu thắng tiếp tục bẻ, nếu thua quay lại theo cầu",
            "Bẻ mạnh: Đặt 100% vốn khi có ≥2 dấu hiệu gãy đồng thời",
            "Bẻ đón đầu: Đặt ngược ở phiên cuối của chu kỳ dự kiến",
            "Bẻ theo đám đông: Đặt ngược lại số đông khi họ đồng loạt theo một cửa"
        ],
        rui_ro: [
            "Bẻ sai → mất vốn + mất cơ hội theo cầu đúng",
            "Bẻ quá sớm → cầu vẫn tiếp tục, thua liên tiếp",
            "Bẻ quá muộn → cầu đã gãy từ trước, đặt ngược lại thành theo cầu mới",
            "Cách phòng: Luôn bẻ nhẹ trước (50% vốn), xác nhận rồi mới bẻ mạnh"
        ],
        ket_hop: [
            "Theo cầu chính 70% vốn, dự phòng 30% để bẻ khi có dấu hiệu",
            "Khi cầu đang mạnh: chỉ theo, không bẻ",
            "Khi cầu có dấu hiệu yếu: giảm vốn theo, chuẩn bị bẻ",
            "Khi bẻ thành công: chuyển sang theo cầu mới ngay"
        ]
    },
    PHAN_5_PBPT: {
        title: "PHẦN 5 – CẦU PBPT (PHÂN BỐ – PHÂN TÍCH) ĐẦY ĐỦ",
        dinh_nghia: "PBPT (Phân Bố - Phân Tích) là phương pháp phân tích sự phân bố của B và P trong một khoảng phiên, từ đó đưa ra dự đoán dựa trên nguyên lý cân bằng thống kê.",
        nguyen_ly: [
            "Trong dài hạn, tỉ lệ B/P xấp xỉ 50/50 (thực tế ~45.86% B, 44.62% P, 9.52% T)",
            "Khi một cửa xuất hiện quá nhiều, cửa còn lại có xu hướng bù đắp",
            "Phân bố không đều tạo ra cơ hội dự đoán",
            "Kết hợp phân bố ngắn hạn (10 phiên) và dài hạn (50 phiên) để đánh giá"
        ],
        cac_dang: [
            { ten: "PBPT cân bằng", mo_ta: "Tỉ lệ B/P trong khoảng 45-55% ở 20-50 phiên gần nhất", cach_doc: "Không có xu hướng rõ, chờ đợi", vi_du: "10B-10P trong 20 phiên" },
            { ten: "PBPT lệch nhẹ", mo_ta: "Tỉ lệ 55-65% nghiêng về một cửa", cach_doc: "Có xu hướng nhẹ, theo cửa mạnh nhưng thận trọng", vi_du: "13B-7P trong 20 phiên" },
            { ten: "PBPT lệch mạnh", mo_ta: "Tỉ lệ 65-75% nghiêng rõ về một cửa", cach_doc: "Theo cửa mạnh, chuẩn bị bẻ khi vượt 70%", vi_du: "14B-6P trong 20 phiên" },
            { ten: "PBPT cực lệch", mo_ta: "Tỉ lệ >75% một cửa", cach_doc: "Rất nguy hiểm, có thể gãy bất cứ lúc nào, ưu tiên bẻ", vi_du: "16B-4P trong 20 phiên" },
            { ten: "PBPT bù trừ", mo_ta: "Sau giai đoạn lệch, cửa yếu bùng nổ để cân bằng", cach_doc: "Đặt cửa yếu sau khi lệch kéo dài", vi_du: "15B-5P → 5B-10P" },
            { ten: "PBPT chu kỳ", mo_ta: "B/P phân bố theo chu kỳ đều đặn", cach_doc: "Xác định vị trí trong chu kỳ để đặt", vi_du: "BBPPBBPPBBPP" },
            { ten: "PBPT nhiễu", mo_ta: "Phân bố ngẫu nhiên, không có quy luật", cach_doc: "Không đặt, chờ phân bố mới", vi_du: "BPBBPBPBPPB" },
            { ten: "PBPT tầng", mo_ta: "Phân bố theo tầng: tầng đầu lệch B, tầng sau lệch P", cach_doc: "Đọc xu hướng từng tầng 10 phiên", vi_du: "Tầng 1: 8B-2P, Tầng 2: 3B-7P" }
        ],
        cach_doc: [
            "Bước 1: Đếm số B và P trong 20 phiên gần nhất",
            "Bước 2: Tính tỉ lệ % của từng cửa",
            "Bước 3: So sánh với 50/50 để xác định độ lệch",
            "Bước 4: Kiểm tra xu hướng 10 phiên gần nhất (ngắn hạn)",
            "Bước 5: Kết hợp ngắn hạn + dài hạn để quyết định theo hay bẻ",
            "Bước 6: Xác định điểm entry tối ưu"
        ],
        ap_dung: [
            "PBPT cân bằng → chờ cầu rõ ràng mới đặt",
            "PBPT lệch nhẹ → theo cửa mạnh với vốn nhỏ",
            "PBPT lệch mạnh → theo cửa mạnh với vốn trung bình, chuẩn bị bẻ",
            "PBPT cực lệch → ưu tiên bẻ, đặt ngược cửa mạnh với vốn nhỏ thăm dò",
            "PBPT bù trừ → đặt cửa yếu (đang bù trừ)",
            "PBPT chu kỳ → đặt theo vị trí chu kỳ",
            "PBPT nhiễu → không đặt",
            "PBPT tầng → đọc từng tầng, đặt theo tầng hiện tại"
        ],
        vi_du: [
            "Ví dụ PBPT lệch mạnh: 20 phiên có 14B-6P → theo B, nhưng khi lên 16B-4P thì bắt đầu bẻ nhẹ sang P",
            "Ví dụ PBPT bù trừ: 30 phiên có 22B-8P, 10 phiên tiếp theo có 3B-7P → P đang bù trừ, đặt P",
            "Ví dụ PBPT chu kỳ: 20 phiên có 10B-10P nhưng phân bố BBPPBBPP... → đọc chu kỳ, đặt theo vị trí"
        ],
        bang_tong_hop: [
            { dang: "Cân bằng", ti_le: "45-55%", hanh_dong: "Chờ", rui_ro: "Thấp" },
            { dang: "Lệch nhẹ", ti_le: "55-65%", hanh_dong: "Theo nhẹ", rui_ro: "Thấp-TB" },
            { dang: "Lệch mạnh", ti_le: "65-75%", hanh_dong: "Theo + chuẩn bị bẻ", rui_ro: "Trung bình" },
            { dang: "Cực lệch", ti_le: ">75%", hanh_dong: "Ưu tiên bẻ", rui_ro: "Cao" },
            { dang: "Bù trừ", ti_le: "Đảo chiều", hanh_dong: "Đặt cửa yếu", rui_ro: "TB-Cao" },
            { dang: "Chu kỳ", ti_le: "Đều đặn", hanh_dong: "Theo chu kỳ", rui_ro: "Thấp" },
            { dang: "Nhiễu", ti_le: "Ngẫu nhiên", hanh_dong: "Không đặt", rui_ro: "Rất cao" },
            { dang: "Tầng", ti_le: "Biến đổi", hanh_dong: "Đọc từng tầng", rui_ro: "Trung bình" }
        ]
    }
};

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

class AMLManager {
    constructor() {
        this.books = new Map();
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

        return {
            "bàn": tableName,
            "phiên": n,
            "cầu": cau,
            "dự đoán": pred,
            "tỉ lệ": percent.toFixed(1) + '%'
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
            const dump = {};
            for (const [t, e] of this.books) {
                dump[t] = {
                    book: e.book.toJSON(),
                    lastKnownResult: e.lastKnownResult
                };
            }
            fs.writeFileSync(AML_STATE_FILE, JSON.stringify(dump));
            console.log(`[AML] Đã lưu state (${Object.keys(dump).length} bàn)`);
        } catch (err) {
            console.error('[AML] Lỗi lưu state:', err.message);
        }
    }

    loadFromFile() {
        try {
            if (!fs.existsSync(AML_STATE_FILE)) return false;
            const dump = JSON.parse(fs.readFileSync(AML_STATE_FILE, 'utf8'));
            for (const [t, obj] of Object.entries(dump)) {
                this.books.set(t, {
                    book: PatternBook.fromJSON(obj.book),
                    lastKnownResult: obj.lastKnownResult || ''
                });
            }
            console.log(`[AML] Đã khôi phục state (${Object.keys(dump).length} bàn)`);
            return true;
        } catch (err) {
            console.error('[AML] Lỗi load state:', err.message);
            return false;
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

const app = express();

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    next();
});

// ======================
// CÁC API CẦU BACCARAT
// ======================
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

// API TÀI LIỆU CẦU
app.get('/api/cau-document', (req, res) => {
    res.json({
        success: true,
        data: CAU_DOCUMENT,
        total_phan: 5
    });
});

app.get('/api/cau-document/:phan', (req, res) => {
    const phan = req.params.phan.toUpperCase();
    const key = Object.keys(CAU_DOCUMENT).find(k => k.includes(phan) || k.startsWith(phan));
    if (key && CAU_DOCUMENT[key]) {
        res.json({ success: true, data: CAU_DOCUMENT[key] });
    } else {
        res.json({ success: false, message: 'Không tìm thấy phần: ' + phan });
    }
});

app.get('/api/cau/phuong-phap', (req, res) => {
    const fullDoc = {
        title: "TÀI LIỆU ĐẦY ĐỦ VỀ CẦU BACCARAT - 5 PHẦN",
        phan_1: CAU_DOCUMENT.PHAN_1_DANH_MUC,
        phan_2: CAU_DOCUMENT.PHAN_2_PHAN_TICH,
        phan_3: CAU_DOCUMENT.PHAN_3_THEO_CAU,
        phan_4: CAU_DOCUMENT.PHAN_4_BE_CAU,
        phan_5: CAU_DOCUMENT.PHAN_5_PBPT
    };
    res.json({ success: true, data: fullDoc });
});

app.get('/api/cau/danh-muc', (req, res) => {
    res.json({ success: true, data: CAU_DOCUMENT.PHAN_1_DANH_MUC });
});

app.get('/api/cau/phan-tich', (req, res) => {
    res.json({ success: true, data: CAU_DOCUMENT.PHAN_2_PHAN_TICH });
});

app.get('/api/cau/theo-cau', (req, res) => {
    res.json({ success: true, data: CAU_DOCUMENT.PHAN_3_THEO_CAU });
});

app.get('/api/cau/be-cau', (req, res) => {
    res.json({ success: true, data: CAU_DOCUMENT.PHAN_4_BE_CAU });
});

app.get('/api/cau/pbpt', (req, res) => {
    res.json({ success: true, data: CAU_DOCUMENT.PHAN_5_PBPT });
});

app.get('/api/cau/pbpt/bang-tong-hop', (req, res) => {
    res.json({ success: true, data: CAU_DOCUMENT.PHAN_5_PBPT.bang_tong_hop });
});

// ======================
// KHỞI ĐỘNG SERVER
// ======================
async function start() {
    console.log('========================================');
    console.log('BACCARAT API SERVER + BCR-AML + CAU DOC');
    console.log('========================================');

    aml.loadFromFile();

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

    setInterval(() => aml.saveToFile(), 60000);
    autoUpdate();

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 API SERVER ĐANG CHẠY TRÊN PORT ${PORT}`);
        console.log(`   http://localhost:${PORT}/api/predict`);
        console.log(`   http://localhost:${PORT}/api/cau-document`);
        console.log(`   http://localhost:${PORT}/api/cau/phuong-phap`);
    });
}

start();
