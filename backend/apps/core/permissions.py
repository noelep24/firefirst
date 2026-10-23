from rest_framework.permissions import SAFE_METHODS, BasePermission


class IsDepartmentMember(BasePermission):
    """Authenticated user who belongs to a department. Default for every API view."""

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.department_id)


class IsOfficerOrReadOnly(IsDepartmentMember):
    """Anyone in the department can read; officers and admins can write."""

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        return request.method in SAFE_METHODS or request.user.is_officer


class IsDepartmentAdminOrReadOnly(IsDepartmentMember):
    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        return request.method in SAFE_METHODS or request.user.is_department_admin


class IsOfficer(IsDepartmentMember):
    def has_permission(self, request, view):
        return super().has_permission(request, view) and request.user.is_officer
