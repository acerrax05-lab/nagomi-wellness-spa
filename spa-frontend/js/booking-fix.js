window.handleBookingTypeChange = function() {
  console.log(' Booking type changed');
  
  const bookingTypeInput = document.querySelector('input[name="bookingType"]:checked');
  
  if (!bookingTypeInput) {
    console.warn('️ No booking type selected');
    return;
  }
  
  const bookingType = bookingTypeInput.value;
  console.log('Selected type:', bookingType);
  
  // Show/hide fields based on booking type
  const guestFields = document.getElementById('guestFields');
  const userFields = document.getElementById('userFields');
  const loginSection = document.getElementById('loginSection');
  
  if (bookingType === 'walk-in' || bookingType === 'guest') {
    // Walk-in or guest booking
    if (guestFields) {
      guestFields.style.display = 'block';
      console.log(' Showing guest fields');
    }
    if (userFields) {
      userFields.style.display = 'none';
    }
    if (loginSection) {
      loginSection.style.display = 'none';
    }
    
  } else if (bookingType === 'online' || bookingType === 'user') {
    // Registered user booking
    if (guestFields) {
      guestFields.style.display = 'none';
    }
    if (userFields) {
      userFields.style.display = 'block';
      console.log(' Showing user fields');
    }
    if (loginSection) {
      loginSection.style.display = 'block';
    }
  }
};

console.log(' handleBookingTypeChange injected globally');