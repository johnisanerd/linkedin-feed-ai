-- Add skip_image column to generated_posts
ALTER TABLE generated_posts ADD COLUMN skip_image BOOLEAN NOT NULL DEFAULT false;
