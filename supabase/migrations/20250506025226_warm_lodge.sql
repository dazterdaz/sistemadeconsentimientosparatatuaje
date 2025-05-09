/*
  # Fix health_questions RLS policies

  1. Changes
    - Drop existing RLS policies for health_questions table
    - Create new RLS policies with proper conditions to allow authenticated users to perform CRUD operations
  
  2. Security
    - Fix RLS policies to ensure authenticated users can properly insert, update, select, and delete health questions
*/

-- First, drop the existing policies for health_questions table
DROP POLICY IF EXISTS "Allow authenticated delete health_questions" ON public.health_questions;
DROP POLICY IF EXISTS "Allow authenticated insert health_questions" ON public.health_questions;
DROP POLICY IF EXISTS "Allow authenticated read health_questions" ON public.health_questions;
DROP POLICY IF EXISTS "Allow authenticated update health_questions" ON public.health_questions;

-- Create new policies with proper conditions
CREATE POLICY "Allow authenticated select health_questions" 
  ON public.health_questions
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated insert health_questions" 
  ON public.health_questions
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated update health_questions" 
  ON public.health_questions
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow authenticated delete health_questions" 
  ON public.health_questions
  FOR DELETE
  TO authenticated
  USING (true);