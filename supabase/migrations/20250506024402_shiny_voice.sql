/*
  # Add RLS policies for the artists table
  
  1. Changes
     - Add INSERT policy for authenticated users
     - Add UPDATE policy for authenticated users
     - Add DELETE policy for authenticated users
  
  2. Security
     - Enables authenticated users to perform all operations on the artists table
     - Maintains existing read access policy
*/

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