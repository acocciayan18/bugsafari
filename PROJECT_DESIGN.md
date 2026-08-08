# Project Design

This chapter presents the design of the BugSafari frontend, the operator-facing part of the system that developers use to launch tests, watch them run, and study the results. BugSafari is an autonomous exploratory testing engine for modern web applications. The frontend, called the Watchtower, gives a single place to control the testing engine and to view what it discovers in real time.

The sections below describe each major interface of the application. Only full-screen pages and the configuration dialog that is central to the testing workflow are covered. Smaller panels that appear inside a larger page, such as the live feed or telemetry streams, are described together as part of the page that contains them.

---

## Landing Page

[Screenshot Placeholder: Landing Page]

Description:
The landing page is the first screen a visitor sees when opening BugSafari. Its purpose is to explain what the tool does and to invite the visitor to try it. The page opens with a short headline and a summary that describe how BugSafari explores a web application on its own and reports the problems it finds, without the user needing to write any test scripts. Below this, the page presents feature highlights, a simple four-step explanation of how the tool works, a preview of the live dashboard, short user testimonials, common questions, and a final call to action. A fixed navigation bar at the top lets the visitor move between in-page sections and reach the Log In and Sign Up screens. This page is important because it sets the visitor's first impression, communicates the value of the tool in plain language, and provides the main entry points into the rest of the system.

---

## Information Pages

[Screenshot Placeholder: Information Pages]

Description:
The information pages give a deeper explanation of BugSafari than the landing page. They are made up of four related views: How It Works, which explains how the engine explores an application and avoids getting stuck; Features, which lists what the tool can do and the kinds of bugs it detects; Who It's For, which describes the students and independent developers the tool is built for and how guest mode works; and About, which explains the motivation behind the project and the values that guide it. Each page shares a common layout with a navigation bar, a title, and structured content such as feature cards, statistics, testing modes, and answers to frequent questions. These pages are important because they help a potential user understand the tool in detail and decide whether it fits their needs before creating an account.

---

## Login Page

[Screenshot Placeholder: Login Page]

Description:
The login page lets an existing user sign in to their account. It presents a simple form with fields for the email address and password, along with a control to show or hide the password. The page checks that both fields are filled in before allowing a sign-in attempt and displays a clear message when something is wrong, such as an incorrect password or an account whose email has not yet been verified. The page also offers a guest access option, which lets a visitor run a full test without creating an account, and links to the sign-up and password-recovery screens. This page is important because it is the main gateway into a user's private workspace and saved testing history.

---

## Sign Up Page

[Screenshot Placeholder: Sign Up Page]

Description:
The sign-up page lets a new user create an account. It collects the information needed to register, checks that the entered details are valid, and shows the strength and requirements of the chosen password so the user can meet the security rules. After a successful registration, the user is guided toward verifying their email address before they can fully use the account. The page also links back to the login screen for users who already have an account. This page is important because it is the first step for a user who wants to keep a permanent history of their tests and use all the features that require an account.

---

## Forgot Password Page

[Screenshot Placeholder: Forgot Password Page]

Description:
The forgot-password page helps a user who cannot remember their password begin the recovery process. The user enters the email address linked to their account and requests a reset. The page confirms that the request has been received and explains that an email with further instructions will be sent if the address matches an account. This page is important because it gives users a safe and simple way to regain access to their account without contacting support.

---

## Reset Password Page

[Screenshot Placeholder: Reset Password Page]

Description:
The reset-password page is where a user sets a new password after following the recovery link sent to their email. The page provides fields for the new password and its confirmation, checks that the two entries match and meet the security requirements, and completes the reset when everything is valid. After the password is changed, the user is directed back to the login screen to sign in with the new password. This page is important because it completes the account recovery process and restores secure access to the user's workspace.

---

## Email Verification Page

[Screenshot Placeholder: Email Verification Page]

Description:
The email verification page confirms that a newly registered user owns the email address they signed up with. When the user opens the verification link from their email, this page checks the link and reports whether the verification succeeded or failed. If the link has expired or is invalid, the page lets the user request a new verification email. This page is important because it protects accounts by making sure each one is tied to a real, reachable email address before it can be used fully.

---

## Main Developer Dashboard

[Screenshot Placeholder: Main Developer Dashboard]

Description:
The main developer dashboard is the central workspace of BugSafari and the screen where testing actually happens. It brings together, in one view, everything an operator needs to start a test, watch it, and control it. At the top is the command center, where the user enters the address of the web application to test, opens the testing configuration, and starts the run. The command center also blocks unsafe targets, such as local addresses or the tool testing itself, and explains why. Once a run begins, the command center shows a live timer and controls to pause, resume, or stop the test, and to save the finished session to history.

Below the command center, the workspace is split into two panels. The left panel is a live feed that shows a continuously updated image of the page the engine is currently interacting with, so the user can watch the exploration as it happens. The right panel is a set of telemetry streams organized into tabs: a telemetry log of the engine's actions, a findings tab that lists the bugs detected, a network tab that shows requests and failures, and a console tab that shows browser messages. A status indicator reports whether the run is active, paused, queued, or finished. This page is the most important interface in the system, because it is where the autonomous engine is directed and where its work is observed in real time.

---

## Testing Configuration

[Screenshot Placeholder: Testing Configuration]

Description:
The testing configuration is a dialog opened from the dashboard's command center before a test is launched. It collects every setting that the engine reads once at the start of a run, organized into three sections. The infiltration section lets the user choose a testing mode, each of which focuses the run on a certain kind of problem, such as tricky form input or behavior under pressure. The navigation section lets the user set how far the engine may travel, from staying on a single exact page, to a section of the site, to the whole site. The target authentication section lets the user provide credentials so the engine can test parts of the application that require signing in. Any changes made here are kept even after the dialog is closed, and the configuration is locked once a run is in progress. This dialog is important because it lets the operator shape and focus each test to match exactly what they want to check.

---

## Forensic History

[Screenshot Placeholder: Forensic History]

Description:
The forensic history page lists the testing sessions a signed-in user has saved. Each entry shows the tested address, a run identifier, the date, the number of steps taken, the testing mode used, how the run ended, and a summary of the most severe findings. The page provides tools to search the saved runs by address, to sort them by different fields, and to filter them by severity. From each entry, the user can open the full report, export the record, or delete it after confirming. The page handles empty states clearly, such as when the user has no history yet or when no runs match the current filters. This page is important because it gives users a lasting record of their testing work that they can revisit, organize, and act on over time.

---

## Report Details

[Screenshot Placeholder: Report Details]

Description:
The report details page shows the full forensic report for a single saved session. It opens with an always-visible summary of the run, including its status, risk level, duration, and the number of findings, along with the routes the engine visited. When available, an insights panel provides a higher-level explanation of the results. The main body of the page presents one self-contained card for each finding, grouping together the description of the problem, where it came from, the exact steps to reproduce it, and a suggested fix. The page also lets the user replay a finding with one action to confirm whether a fix has resolved it. This page is important because it turns the raw output of a test into a clear, organized document that a developer can read, understand, and use to repair their application.

---

## Settings

[Screenshot Placeholder: Settings]

Description:
The settings page lets the user manage their account and control how the application behaves. It is organized into two cards. The account card shows the user's identity, provides a way to change the password, and offers a sign-out control; for guest users, it explains that runs are not saved and offers a way to leave guest mode. The application card lets the user choose a light, dark, or system theme, turn desktop notifications on or off, and enable automatic saving of finished runs. The page adapts to whether the user is signed in with a full account or using guest mode, showing only the options that apply. This page is important because it gives users control over their personal preferences, the appearance of the tool, and the security of their account.
