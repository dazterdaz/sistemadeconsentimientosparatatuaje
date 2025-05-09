/*
  # Add RLS policies for health_questions table
  
  1. Changes
     - Add INSERT policy for authenticated users
     - Add UPDATE policy for authenticated users
     - Add DELETE policy for authenticated users
  
  2. Security
     - Enables authenticated users to perform all operations on the health_questions table
     - Maintains existing read access policy
*/

-- Drop existing policy if it exists
DROP POLICY IF EXISTS "Allow authenticated read health_questions" ON public.health_questions;
DROP POLICY IF EXISTS "Allow authenticated insert health_questions" ON public.health_questions;
DROP POLICY IF EXISTS "Allow authenticated update health_questions" ON public.health_questions;
DROP POLICY IF EXISTS "Allow authenticated delete health_questions" ON public.health_questions;

-- Allow authenticated users to read health questions
CREATE POLICY "Allow authenticated read health_questions"
ON public.health_questions
FOR SELECT
TO authenticated
USING (true);

-- Allow authenticated users to insert new health questions
CREATE POLICY "Allow authenticated insert health_questions"
ON public.health_questions
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Allow authenticated users to update health questions
CREATE POLICY "Allow authenticated update health_questions"
ON public.health_questions
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Allow authenticated users to delete health questions
CREATE POLICY "Allow authenticated delete health_questions"
ON public.health_questions
FOR DELETE
TO authenticated
USING (true);

-- Alternatively, we could use a single policy for all operations
-- but using separate policies for each operation provides more flexibility
-- DROP POLICY IF EXISTS "Allow authenticated CRUD health_questions" ON public.health_questions;
-- CREATE POLICY "Allow authenticated CRUD health_questions"
-- ON public.health_questions
-- FOR ALL
-- TO authenticated
-- USING (true)
-- WITH CHECK (true);