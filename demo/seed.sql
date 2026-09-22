-- Fictional social calendar for an isolated demo. No real accounts, handles or published links.
-- Channels are unconnected: publishing from the demo records a per-channel failure explaining the missing connection.
INSERT INTO channels (id,name,platform,handle,color,created_at) VALUES
(1,'Northlight Studio','twitter','@northlight_demo','#1da1f2',datetime('now','-40 days')),
(2,'Northlight Studio','linkedin','northlight-studio-demo','#0a66c2',datetime('now','-40 days')),
(3,'Northlight Studio','bluesky','northlight.example.test','#0085ff',datetime('now','-20 days'));

INSERT INTO labels (id,name,color,created_at) VALUES
(1,'Launch','#8b5cf6',datetime('now','-40 days')),
(2,'Tips','#10b981',datetime('now','-40 days')),
(3,'Behind the scenes','#f59e0b',datetime('now','-30 days'));

INSERT INTO posts (id,content,status,scheduled_at,published_at,created_at,updated_at) VALUES
(1,'Three things we changed after our first 100 client projects: shorter kickoff calls, one shared checklist, and a weekly five-minute status note. Which would you try first?','draft',NULL,NULL,datetime('now','-3 days'),datetime('now','-3 days')),
(2,'Draft idea: a thread on how we name project files so nobody asks "which final is final?"','draft',NULL,NULL,datetime('now','-1 days'),datetime('now','-1 days')),
(3,'The new Northlight planner templates go live tomorrow. Weekly, monthly and project views, all free to download.','scheduled',strftime('%Y-%m-%dT09:00:00.000Z','now','+1 day'),NULL,datetime('now','-2 days'),datetime('now','-2 days')),
(4,'We are opening two new spots for spring projects. If your team needs a brand refresh before the busy season, reply here and we will send the details.','scheduled',strftime('%Y-%m-%dT08:30:00.000Z','now','+3 days'),NULL,datetime('now','-2 days'),datetime('now','-2 days')),
(5,'Tip: write the decision you need at the top of every status update. It turns a report into a request.','scheduled',strftime('%Y-%m-%dT15:00:00.000Z','now','+6 days'),NULL,datetime('now','-1 days'),datetime('now','-1 days')),
(6,'A look inside this week''s studio: sketches on the wall, a very full whiteboard, and far too much coffee.','published',strftime('%Y-%m-%dT10:00:00.000Z','now','-2 days'),strftime('%Y-%m-%d 10:00:04','now','-2 days'),datetime('now','-6 days'),datetime('now','-2 days')),
(7,'Small studios win on speed. Here is how we keep feedback rounds to two days.','published',strftime('%Y-%m-%dT12:00:00.000Z','now','-5 days'),strftime('%Y-%m-%d 12:00:03','now','-5 days'),datetime('now','-8 days'),datetime('now','-5 days')),
(8,'Our favourite tools for remote workshops, in one list.','failed',strftime('%Y-%m-%dT16:00:00.000Z','now','-1 day'),NULL,datetime('now','-4 days'),datetime('now','-1 days'));

INSERT INTO post_channels (post_id,channel_id,status,error,published_at,attempts) VALUES
(1,2,'pending',NULL,NULL,0),
(2,1,'pending',NULL,NULL,0),
(3,1,'pending',NULL,NULL,0),
(3,3,'pending',NULL,NULL,0),
(4,2,'pending',NULL,NULL,0),
(5,1,'pending',NULL,NULL,0),
(6,1,'published',NULL,strftime('%Y-%m-%d 10:00:04','now','-2 days'),1),
(6,2,'published',NULL,strftime('%Y-%m-%d 10:00:04','now','-2 days'),1),
(7,3,'published',NULL,strftime('%Y-%m-%d 12:00:03','now','-5 days'),1),
(8,1,'failed','No Twitter credentials. Connect Twitter in Clawnify.',NULL,1);

INSERT INTO post_labels (post_id,label_id) VALUES
(1,2),(3,1),(4,1),(5,2),(6,3),(7,2),(8,2);
