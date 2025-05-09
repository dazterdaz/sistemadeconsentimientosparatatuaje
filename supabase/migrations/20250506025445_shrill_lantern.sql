/*
  # Fix Row-Level Security for health_questions table

  1. Changes
    - Drop existing RLS policies for health_questions table
    - Create new permissive policies that correctly allow authenticated users to perform CRUD operations
    
  2. Security
    - Ensure authenticated users can properly insert, select, update, and delete health questions
    - Fix the current issue where new rows violate the RLS policy
*/

-- First, drop the existing policies that are causing problems
DROP POLICY IF EXISTS "Allow authenticated delete health_questions" ON public.health_questions;
DROP POLICY IF EXISTS "Allow authenticated insert health_questions" ON public.health_questions;
DROP POLICY IF EXISTS "Allow authenticated select health_questions" ON public.health_questions;
DROP POLICY IF EXISTS "Allow authenticated update health_questions" ON public.health_questions;

-- Now create new policies with proper permissions
-- Policy for INSERT operations
CREATE POLICY "Allow authenticated users to insert health_questions"
ON public.health_questions
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Policy for SELECT operations
CREATE POLICY "Allow authenticated users to select health_questions"
ON public.health_questions
FOR SELECT
TO authenticated
USING (true);

-- Policy for UPDATE operations
CREATE POLICY "Allow authenticated users to update health_questions"
ON public.health_questions
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Policy for DELETE operations
CREATE POLICY "Allow authenticated users to delete health_questions"
ON public.health_questions
FOR DELETE
TO authenticated
USING (true);