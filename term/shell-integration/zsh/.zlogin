# helmterm: the user's .zlogin from their real ZDOTDIR (see .zshenv), then
# ZDOTDIR handed back.
ZDOTDIR=$__helmterm_user_zdotdir
[[ -r $ZDOTDIR/.zlogin ]] && source $ZDOTDIR/.zlogin
__helmterm_user_zdotdir=$ZDOTDIR
ZDOTDIR=$__helmterm_zdotdir
__helmterm_handback
