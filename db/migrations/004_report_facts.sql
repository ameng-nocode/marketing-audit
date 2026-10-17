-- The report step (check 7) saves a fact too.
alter table facts drop constraint facts_check_no_check;
alter table facts add constraint facts_check_no_check check (check_no between 1 and 7);
