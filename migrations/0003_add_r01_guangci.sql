-- 淡水信義線東延段：R01 廣慈/奉天宮（2026-08-30 通車，紅線新終點）
-- 既有資料庫可用 wrangler d1 migrations apply 套用；seed.sql 已同步更新。

INSERT OR IGNORE INTO stations (id, name_zh, name_en, line, line_name, line_color, station_number, latitude, longitude, is_transfer_station, transfer_lines, district) VALUES
('R01', '廣慈/奉天宮', 'Guangci/Fengtian Temple', 'R', '淡水信義線', '#E3002C', 1, 25.0375, 121.5819, 0, NULL, '信義區');

INSERT OR IGNORE INTO station_tags (station_id, tag_category, tag_score, tag_reason) VALUES
('R01', 'attraction', 0.7, '奉天宮、松山慈惠堂、廣慈博愛園區'),
('R01', 'food', 0.4, '周邊以住宅與社福園區為主'),
('R01', 'shopping', 0.3, '鄰近福德街生活圈'),
('R01', 'nightlife', 0.2, '夜間活動較少'),
('R01', 'family', 0.8, '廣慈博愛園區、社福設施與親子友善空間');

INSERT OR IGNORE INTO pagerank_scores (station_id, time_period, pr_value, pr_rank, normalized_score) VALUES
('R01', 'morning_peak', 0.002, 94, 0.02),
('R01', 'morning', 0.002, 94, 0.02),
('R01', 'noon', 0.002, 94, 0.02),
('R01', 'afternoon', 0.003, 88, 0.04),
('R01', 'evening_peak', 0.002, 94, 0.02),
('R01', 'night', 0.002, 94, 0.02);

INSERT OR IGNORE INTO travel_costs (from_station_id, to_station_id, station_count, transfer_count, estimated_time, cost_score) VALUES
('BL12', 'R01', 10, 1, 23, 0.32),
('BL11', 'R01', 8, 1, 19, 0.27),
('R03', 'R01', 2, 0, 4, 0.05),
('BL15', 'R01', 8, 1, 19, 0.27),
('R11', 'R01', 10, 0, 20, 0.25),
('BL18', 'R01', 4, 1, 11, 0.18),
('R01', 'R02', 1, 0, 2, 0.02),
('R01', 'R03', 2, 0, 4, 0.05),
('R01', 'R04', 3, 0, 6, 0.08),
('R01', 'R05', 4, 0, 8, 0.10),
('R01', 'R06', 5, 0, 10, 0.13),
('R01', 'R07', 6, 0, 12, 0.15),
('R01', 'R08', 7, 0, 14, 0.18),
('R01', 'R09', 8, 0, 16, 0.20),
('R01', 'R11', 10, 0, 20, 0.25),
('R01', 'BL12', 11, 1, 25, 0.35),
('R01', 'BL11', 12, 1, 27, 0.38),
('R01', 'BL15', 9, 1, 21, 0.30),
('R01', 'BL18', 5, 1, 13, 0.20),
('R01', 'R28', 29, 0, 60, 0.80);
