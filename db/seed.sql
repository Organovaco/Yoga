INSERT OR IGNORE INTO classes (id, slug, title, description, instructor, style, level, duration_min, r2_key, is_free_preview, published, created_at) VALUES
('c1','gentle-morning-flow','Gentle morning flow','A slow wake-up sequence for stiff shoulders and a sleepy spine.','Instructor name','Hatha','Beginner',20,'videos/gentle-morning-flow.mp4',1,1,strftime('%s','now')),
('c2','strong-core-vinyasa','Strong core vinyasa','Linked movement with steady breath and focused core work.','Instructor name','Vinyasa','Intermediate',35,'videos/strong-core-vinyasa.mp4',0,1,strftime('%s','now')),
('c3','deep-hip-yin','Deep hip yin','Long, quiet holds to release the hips and lower back.','Instructor name','Yin','All levels',40,'videos/deep-hip-yin.mp4',0,1,strftime('%s','now')),
('c4','desk-reset','Desk reset','Ten minutes to undo a day of sitting.','Instructor name','Hatha','Beginner',10,'videos/desk-reset.mp4',0,1,strftime('%s','now')),
('c5','evening-wind-down','Evening wind down','Restorative shapes and breathing to prepare for sleep.','Instructor name','Restorative','All levels',25,'videos/evening-wind-down.mp4',0,1,strftime('%s','now')),
('c6','power-flow','Power flow','A sweaty, athletic flow for experienced practitioners.','Instructor name','Vinyasa','Advanced',45,'videos/power-flow.mp4',0,1,strftime('%s','now'));
