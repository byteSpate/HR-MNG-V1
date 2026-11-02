-- A Super Admin with no Employee record may run the Saturday meeting.
ALTER TABLE "FunnelMeeting" ALTER COLUMN "ranByEmployeeId" DROP NOT NULL;
