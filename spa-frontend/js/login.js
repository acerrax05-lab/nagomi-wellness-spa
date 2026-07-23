// js/login.js
const API_BASE = 'https://nagomi-backend.onrender.com/api';

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();
  const msg = document.getElementById("loginMessage");

  if (!email || !password) {
    msg.textContent = "️ Please fill in both fields.";
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json(); //  Fixed: was 'res'

    if (!response.ok) { //  Fixed: was 'res'
      msg.textContent = ` ${data.msg || "Invalid credentials"}`;
      return;
    }

    //  Only allow admin and therapist to login
    if (data.user.role !== "admin" && data.user.role !== "therapist") {
      msg.textContent = " Access denied. Staff login only.";
      return;
    }

    // Save token and user info
    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    localStorage.setItem("role", data.user.role);
    localStorage.setItem("userId", data.user._id);

    msg.textContent = " Login successful! Redirecting...";

    // Redirect based on role
    setTimeout(() => {
      if (data.user.role === "admin") {
        window.location.href = "admin.html";
      } else if (data.user.role === "therapist") {
        window.location.href = "therapist.html";
      }
    }, 1000);

  } catch (err) {
    console.error("Login error:", err);
    msg.textContent = " Server error. Please try again later.";
  }
});