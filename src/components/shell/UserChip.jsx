// Sidebar footer identity chip.
import React from 'react';
import { useUser } from '@clerk/clerk-react';

export default function UserChip() {
  const { user } = useUser();
  const name = user?.fullName || user?.firstName || 'Signed in';
  return (
    <div className="who">{name}<br />Room 117</div>
  );
}
