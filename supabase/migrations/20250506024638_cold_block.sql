/*
  # Fix RLS policies for artists table
  
  1. Security
    - Enable RLS on artists table
    - Drop existing policies (if any)
    - Create proper policies for authenticated users to perform CRUD operations
*/

-- Make sure RLS is enabled
ALTER TABLE public.artists ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (using IF EXISTS which doesn't require checking pg_policies)
DROP POLICY IF EXISTS "Allow authenticated insert artists" ON public.artists;
DROP POLICY IF EXISTS "Allow authenticated update artists" ON public.artists;
DROP POLICY IF EXISTS "Allow authenticated delete artists" ON public.artists;
DROP POLICY IF EXISTS "Allow authenticated read artists" ON public.artists;

-- Create policies with proper settings
-- Allow authenticated users to insert new artists
CREATE POLICY "Allow authenticated insert artists"
ON public.artists
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Allow authenticated users to update artists
CREATE POLICY "Allow authenticated update artists"
ON public.artists
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Allow authenticated users to delete artists
CREATE POLICY "Allow authenticated delete artists"
ON public.artists
FOR DELETE
TO authenticated
USING (true);

-- Allow authenticated users to read artists
CREATE POLICY "Allow authenticated read artists"
ON public.artists
FOR SELECT
TO authenticated
USING (true);