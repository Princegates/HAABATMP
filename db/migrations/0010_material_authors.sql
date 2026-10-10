-- Instructors can add learning material to the courses they teach and remove what they added. Staff can remove anything.
alter table course_modules add column created_by uuid references users(id);
alter table learning_materials add column created_by uuid references users(id);
