import { NavLink } from "react-router-dom";

export default function NavButtons() {
    return (
        <nav className="navbar">
            <div className="nav-links">
                <NavLink to="/" end>
                    Menu
                </NavLink>
            </div>
        </nav>
    );
}