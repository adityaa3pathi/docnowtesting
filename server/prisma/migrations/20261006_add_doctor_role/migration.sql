-- Migration: Add DOCTOR role for the consultation module
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'DOCTOR';
