import NavButtons from "../components/NavButtons";
import { Link, NavLink } from "react-router-dom";

export default function Menu() {
    return (
        <div className="page">
            <NavButtons />

            <div className="menu-grid nav-links">
                <NavLink to="/settings">Settings</NavLink>
                <NavLink to="/training">Training</NavLink>
                <NavLink to="/minigames">Mini Games</NavLink>
            </div>
        </div>
    );
}
